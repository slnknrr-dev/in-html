// sudoku-game/dialogs.js - the dialogs: rules of a variant with an example (and its solution), settings (skin,
// symbols, aids), how to play, statistics, export (SVG, PNG, print), opening a puzzle code or a classic grid text, and
// the progress of a puzzle being made.
//
//   rulesDialog(id)  settingsDialog(onChange)  helpDialog()  statsDialog()  exportDialog(game)  openCodeDialog(onOpen)
//   busyDialog(text) -> { set(fraction), close(), signal }

//
// All dialogs go through ui/overlays.js openDialog (focus trap, Escape, stacking). Settings apply live (no Save):
// each control writes prefs and calls onChange so the board behind the dialog updates immediately.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t, UI_STATE } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';
import { download } from '../ui/app.js';
import { puzzleSVG, EXPORT_CSS } from '../sudoku/svg.js';
import { decodePuzzle, parseGrid } from '../sudoku/codec.js';
import { variant as variantOf } from '../sudoku/variants.js';
import { ALPHABETS, parseCustom } from '../sudoku/symbols.js';
import { SKINS, prefs, resetStats, setPrefs, stats } from './store.js';
import { fmtTime, gameTitle, legendNeeded, symbolsOf, variantName } from './common.js';
import { example, picture } from './pictures.js';

// --- rules ----------------------------------------------------------------------------------------------------------------

// The example picture arrives asynchronously from the shared example cache (pictures.js); a spinner holds its space.
// The solution toggle stays disabled until the example exists. "-neg" rules (negative constraints implied by a
// variant) are hidden from the "also applies" list: they are part of that variant's own rule text.
export function rulesDialog(id, { onPlay } = {}) {
  const v = variantOf(id);
  if (!v) return;
  const pic = h('div', { class: 'sg-rules-pic' }, h('div', { class: 'ed-spinner' }));
  let shown = false, ex = null;
  const toggle = h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: true, onclick: () => { shown = !shown; draw(); } }, iconEl('eye'), t('sg.showSolution'));
  const draw = () => {
    if (!ex) return;
    const syms = symbolsOf(ex.puzzle.n);
    pic.innerHTML = picture(ex.puzzle, syms, { solution: shown ? ex.solution : null, cls: 'sg-pic sg-pic-rules', label: t('sg.exampleOf', { name: variantName(id) }) });
    toggle.lastChild.textContent = shown ? t('sg.hideSolution') : t('sg.showSolution');
    toggle.disabled = false;
  };
  example(id).then((x) => { ex = x; draw(); });
  const paras = String(t('sg.vr.' + id)).split('\n').filter(Boolean).map((p) => h('p', {}, p));
  const rulesList = (v.rules || []).filter((r) => !/-neg$/.test(r) && r !== id);
  const body = h('div', { class: 'sg-rules' },
    h('div', { class: 'sg-rules-text' },
      h('p', { class: 'sg-rules-lead' }, t('sg.basicRule')),
      ...paras,
      rulesList.length ? h('p', { class: 'sg-muted' }, t('sg.alsoRules', { list: rulesList.map((r) => t('sg.v.' + r)).join(', ') })) : null,
      h('p', { class: 'sg-muted' }, t('sg.symbolsNote'))),
    h('figure', { class: 'sg-rules-fig' }, pic, h('figcaption', { class: 'sg-row' }, h('span', { class: 'sg-muted' }, t('sg.example')), toggle)));
  return openDialog({
    title: variantName(id), body, wide: true, className: 'sg-dlg',
    buttons: [{ label: t('dlg.close'), value: null }, onPlay ? { label: t('sg.playThis'), value: 'play', primary: true, onClick: () => { onPlay(id); } } : null].filter(Boolean),
  });
}

// --- settings ---------------------------------------------------------------------------------------------------------------

// Skins as a radiogroup of buttons (aria-checked); switches are checkboxes with role=switch. Every label is tied by
// for/id, so the whole row is clickable and screen readers read the hint with the control.
export function settingsDialog(onChange) {
  const p = prefs();
  const sw = (key, label, hint) => {
    const c = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!p[key] });
    c.addEventListener('change', () => { setPrefs({ [key]: c.checked }); onChange(); });
    const id = 'sg-set-' + key;
    c.id = id;
    return h('div', { class: 'sg-set-row' }, h('label', { for: id, class: 'sg-set-l' }, h('b', {}, t(label)), hint ? h('small', {}, t(hint)) : null), c);
  };
  const skins = h('div', { class: 'sg-skins sg-skins-big', role: 'radiogroup', 'aria-label': t('sg.skin') });
  const paintSkins = () => {
    skins.textContent = '';
    for (const k of SKINS) {
      skins.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(prefs().skin === k), class: 'sg-skin sg-skin-' + k + (prefs().skin === k ? ' sg-on' : ''),
        onclick: () => { setPrefs({ skin: k }); onChange('skin'); paintSkins(); },
      }, h('span', { class: 'sg-skin-sw' }, h('i'), h('i'), h('i')), h('span', { class: 'sg-skin-name' }, t('sg.skin.' + k))));
    }
  };
  paintSkins();
  // Each alphabet shows its capacity (max symbols): a 16x16 grid cannot use a 9-symbol alphabet; symbolsOf falls back
  // to digits in that case.
  const abc = h('select', { class: 'ed-input ed-select', id: 'sg-set-abc' },
    [...Object.keys(ALPHABETS).map((id) => h('option', { value: id, selected: p.alphabet === id }, `${t('sg.abc.' + id)} (${ALPHABETS[id].max})`)), h('option', { value: 'custom', selected: p.alphabet === 'custom' }, t('sg.abc.custom'))]);
  const custom = h('input', { class: 'ed-input', value: p.custom, placeholder: t('sg.customAny'), hidden: p.alphabet !== 'custom', spellcheck: 'false' });
  const note = h('small', { class: 'sg-muted' });
  const paintNote = () => {
    const r = parseCustom(prefs().custom, 1);
    note.textContent = prefs().alphabet === 'custom' ? (r.error === 'duplicate' || r.error === 'long' ? t('sg.customErr.' + r.error, { n: r.count, count: r.count }) : t('sg.customCount', { n: r.count || 0 })) : t('sg.abcNote');
  };
  abc.addEventListener('change', () => { setPrefs({ alphabet: abc.value }); custom.hidden = abc.value !== 'custom'; paintNote(); onChange(); });
  custom.addEventListener('input', () => { setPrefs({ custom: custom.value }); paintNote(); onChange(); });
  paintNote();
  const body = h('div', { class: 'sg-settings' },
    h('h3', { class: 'sg-h3' }, t('sg.skin')), skins,
    h('h3', { class: 'sg-h3' }, t('sg.symbols')), h('div', { class: 'sg-set-abc' }, abc, custom, note),
    h('h3', { class: 'sg-h3' }, t('sg.aids')),
    sw('peers', 'sg.set.peers', 'sg.set.peersHint'),
    sw('same', 'sg.set.same', 'sg.set.sameHint'),
    sw('conflicts', 'sg.set.conflicts', 'sg.set.conflictsHint'),
    sw('mistakes', 'sg.set.mistakes', 'sg.set.mistakesHint'),
    sw('autoNotes', 'sg.set.autoNotes', 'sg.set.autoNotesHint'),
    sw('counts', 'sg.set.counts', 'sg.set.countsHint'),
    sw('owners', 'sg.set.owners', 'sg.set.ownersHint'),
    sw('timer', 'sg.set.timer', null),
    sw('sound', 'sg.set.sound', null));
  return openDialog({ title: t('sg.settings'), body, className: 'sg-dlg' });
}

// --- help ------------------------------------------------------------------------------------------------------------------------

export function helpDialog() {
  // keys as keycaps; gestures and modes as plain words
  const sec = (title, rows, keys = false) => h('section', { class: 'sg-help-sec' }, h('h3', { class: 'sg-h3' }, t(title)),
    h('dl', { class: 'sg-keys' }, rows.map(([k, v]) => h('div', {}, h('dt', {}, keys ? k.split(' ').map((x) => h('kbd', {}, x)) : h('b', {}, k)), h('dd', {}, t(v))))));
  const body = h('div', { class: 'sg-help' },
    h('p', {}, t('sg.help.intro')),
    sec('sg.help.touch', [[t('sg.k.tap'), 'sg.help.tap'], [t('sg.k.drag'), 'sg.help.drag'], [t('sg.k.double'), 'sg.help.double'], [t('sg.k.long'), 'sg.help.long'], [t('sg.k.pinch'), 'sg.help.pinch']]),
    sec('sg.help.keys', [['1…9 A…P', 'sg.help.symbols'], ['Shift+1…9', 'sg.help.corner'], ['Alt+1…9', 'sg.help.center'], ['Del', 'sg.help.erase'], ['← ↑ → ↓', 'sg.help.arrows'],
      ['Space', 'sg.help.space'], ['Z X C V', 'sg.help.modes'], ['Ctrl+Z Ctrl+Y', 'sg.help.undo'], ['H', 'sg.help.hint'], ['P', 'sg.help.pause'], ['Ctrl+wheel + −', 'sg.help.zoom']], true),
    h('p', { class: 'sg-muted' }, t('sg.help.letters')),
    sec('sg.help.modesT', [[t('sg.m.value'), 'sg.m.valueHint'], [t('sg.m.corner'), 'sg.m.cornerHint'], [t('sg.m.center'), 'sg.m.centerHint'], [t('sg.m.color'), 'sg.m.colorHint']]),
    h('p', { class: 'sg-muted' }, t('sg.help.privacy')));
  return openDialog({ title: t('sg.help'), body, wide: true, className: 'sg-dlg' });
}

// --- statistics -------------------------------------------------------------------------------------------------------------------

// Rows sorted by games played; the average counts solved games only (unsolved games have no meaningful time).
export function statsDialog() {
  const s = stats();
  const entries = Object.entries(s.games).sort((a, b) => b[1].played - a[1].played);
  const total = entries.reduce((a, [, r]) => ({ played: a.played + r.played, solved: a.solved + r.solved, clean: a.clean + r.clean }), { played: 0, solved: 0, clean: 0 });
  const name = (key) => {
    const [v, n, d] = key.split(':');
    return `${variantName(v)} · ${n}×${n} · ${t('sg.d.' + d)}`;
  };
  const body = h('div', { class: 'sg-stats' },
    h('div', { class: 'sg-stat-tiles' },
      tile(total.played, t('sg.st.played')), tile(total.solved, t('sg.st.solved')), tile(total.clean, t('sg.st.clean')),
      tile(total.played ? Math.round((total.solved / total.played) * 100) + '%' : '–', t('sg.st.rate'))),
    entries.length ? h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('sg.st.game')), h('th', {}, t('sg.st.solved')), h('th', {}, t('sg.st.best')), h('th', {}, t('sg.st.avg')))),
      h('tbody', {}, entries.map(([k, r]) => h('tr', {}, h('td', {}, name(k)), h('td', {}, `${r.solved}/${r.played}`), h('td', {}, r.best != null ? fmtTime(r.best) : '–'), h('td', {}, r.solved ? fmtTime(r.total / r.solved) : '–')))))) : h('p', { class: 'ap-empty' }, t('sg.st.none')));
  return openDialog({
    title: t('sg.stats'), body, wide: true, className: 'sg-dlg',
    buttons: [{ label: t('sg.st.reset'), danger: true, onClick: async () => { if (await confirmDialog(t('sg.st.reset'), t('sg.st.resetQ'), t('sg.st.reset'), true)) { resetStats(); return true; } return false; } }, { label: t('dlg.close'), value: null, primary: true }],
  });
}

const tile = (v, label) => h('div', { class: 'sg-tile' }, h('b', {}, String(v)), h('span', {}, label));

// --- export ------------------------------------------------------------------------------------------------------------------------

// Export SVGs embed their own stylesheet (EXPORT_CSS from svg.js): a downloaded file has no app.css, so it must be
// self-contained and print in neutral black-on-white regardless of the current skin.
const PRINT_CSS = EXPORT_CSS + '.sd-wrong{fill:#c92a2a}';

function exportSVG(game, what) {
  const syms = symbolsOf(game.puzzle.n);
  const values = what === 'progress' ? game.board.values : null;
  const solution = what === 'solution' ? game.solution : null;
  return puzzleSVG(game.puzzle, { values, solution, symbols: syms, title: gameTitle(game.puzzle), css: PRINT_CSS });
}

// Sanitised: variant and seed may contain any characters; file names keep [a-z0-9-] only, seed capped at 40.
function fileName(game, ext) {
  const v = (game.puzzle.variant || 'sudoku').replace(/[^a-z0-9]+/gi, '-');
  return `sudoku-${v}-${game.puzzle.n}x${game.puzzle.n}${game.puzzle.seed ? '-' + game.puzzle.seed.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) : ''}.${ext}`;
}

// Rasterise through an <img> + canvas: the browser's own SVG renderer, no library. Blob URL (not data:) avoids huge
// strings; same-origin blob keeps the canvas untainted so toBlob works. White background filled first because PNG
// export of a transparent board looks broken in most viewers. 2x scale for print-quality pixels.
async function svgToPng(svgText, scale = 2) {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

// Printing uses a hidden #sg-print container plus @media print rules in app.css (everything else display:none),
// rather than a popup window: popups are blocked, and an iframe would not inherit fonts.
function printSVG(svgText, title, legend) {
  let box = document.getElementById('sg-print');
  if (!box) { box = h('div', { id: 'sg-print' }); document.body.append(box); }
  box.innerHTML = '';
  box.append(h('h1', {}, title), h('div', { class: 'sg-print-board', html: svgText }), legend ? h('p', {}, legend) : null, h('p', { class: 'sg-print-rules' }, t('sg.basicRule')),
    h('p', { class: 'sg-print-rules' }, String(t('sg.vr.' + (document.body.dataset.printVariant || 'classic'))).split('\n')[0]));
  window.print();
}

export function exportDialog(game) {
  let what = 'puzzle';
  const preview = h('div', { class: 'sg-export-prev' });
  const paint = () => { preview.innerHTML = exportSVG(game, what); };
  const items = [['puzzle', t('sg.ex.puzzle')], ['progress', t('sg.ex.progress')]];
  if (game.solution && (game.finished || game.kind === 'solo')) items.push(['solution', t('sg.ex.solution')]);
  const seg = h('div', { class: 'sg-seg' }, items.map(([k, l]) => h('button', {
    type: 'button', class: 'sg-seg-b' + (k === what ? ' sg-on' : ''),
    onclick: (e) => { what = k; for (const b of seg.children) b.classList.toggle('sg-on', b === e.currentTarget); paint(); },
  }, l)));
  paint();
  const syms = symbolsOf(game.puzzle.n);
  const legend = legendNeeded(game.puzzle, syms) ? syms.map((s, i) => `${s.text}=${i + 1}`).join('  ') : '';
  const body = h('div', { class: 'sg-export' }, seg, preview);
  return openDialog({
    title: t('sg.export'), body, wide: true, className: 'sg-dlg',
    buttons: [
      { label: 'SVG', icon: 'download', onClick: () => { download(exportSVG(game, what), fileName(game, 'svg'), 'image/svg+xml'); return false; } },
      { label: 'PNG', icon: 'image', onClick: async () => { try { download(await svgToPng(exportSVG(game, what)), fileName(game, 'png'), 'image/png'); } catch (e) { toast(t('sg.pngFail'), 'error'); } return false; } },
      { label: t('sg.print'), icon: 'print', primary: true, onClick: () => { document.body.dataset.printVariant = game.puzzle.variant || 'classic'; printSVG(exportSVG(game, what), gameTitle(game.puzzle), legend); return false; } },
    ],
  });
}

// --- open a code ---------------------------------------------------------------------------------------------------------------------

// Accepts a bare puzzle code, a whole share link (the p= parameter is extracted) or a plain grid text
// ("53..7...." style) as the fallback parser.
export function openCodeDialog(onOpen) {
  const ta = h('textarea', { class: 'ed-input ed-textarea sg-code-in', rows: 4, spellcheck: 'false', placeholder: t('sg.codePh') });
  const msg = h('div', { class: 'sg-field-h' });
  const body = h('div', { class: 'sg-field' }, h('label', { class: 'sg-field-l' }, t('sg.codeLabel')), ta, msg, h('p', { class: 'sg-muted' }, t('sg.codeHint')));
  return openDialog({
    title: t('sg.openCode'), body, className: 'sg-dlg',
    buttons: [{ label: t('dlg.cancel'), value: null }, {
      label: t('sg.open'), primary: true, onClick: () => {
        const text = ta.value.trim();
        let puzzle = null;
        try {
          const m = /[#&?]p=([A-Za-z0-9_-]+)/.exec(text);
          puzzle = decodePuzzle(m ? m[1] : text);
        } catch { puzzle = parseGrid(text); }
        if (!puzzle) { msg.textContent = t('sg.codeBad'); msg.classList.add('sg-err'); return false; }
        onOpen(puzzle);
        return true;
      },
    }],
  });
}

// --- progress of making a puzzle ------------------------------------------------------------------------------------------------------

// Closing the dialog by Cancel, Escape or the backdrop (value null) aborts the job; close('done') from the caller
// does not. The elapsed time appears only after 3 s, so quick jobs do not flash a counter.
export function busyDialog(text) {
  const ctrl = new AbortController();
  const bar = h('div', { class: 'ap-progress' }, h('i'));
  const label = h('div', { class: 'sg-busy-l' }, text);
  let closeFn = null;
  const pct = h('span', { class: 'sg-muted' }, '');
  const body = h('div', { class: 'sg-busy' }, h('div', { class: 'sg-busy-anim', 'aria-hidden': 'true' }, ...Array.from({ length: 9 }, (_, i) => h('i', { style: { '--i': i } }))), label, bar, pct);
  const started = Date.now();
  openDialog({
    title: t('sg.making'), body, className: 'sg-dlg sg-busy-dlg',
    buttons: [{ label: t('dlg.cancel'), value: 'cancel' }],
    onMount: ({ close }) => { closeFn = close; },
  }).then((v) => { if (v === 'cancel' || v === null) ctrl.abort(); });
  return {
    signal: ctrl.signal,
    set(fraction) {
      const f = Math.max(0, Math.min(1, fraction || 0));
      bar.firstChild.style.width = Math.round(f * 100) + '%';
      const secs = (Date.now() - started) / 1000;
      pct.textContent = secs > 3 ? t('sg.makingFor', { s: Math.round(secs) }) : '';
    },
    close() { if (closeFn) closeFn('done'); },
  };
}

export { UI_STATE };
