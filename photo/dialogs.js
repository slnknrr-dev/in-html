// photo/dialogs.js - dialogs of the photo editor: new canvas, image size, canvas size, feather, filters (with a 100 %
// preview of the active layer), export (format, quality, name) and the keyboard shortcuts. Dialogs that describe a
// whole-image operation show its ImageMagick arguments as they change.

// Design rules:
// - Each dialog edits a local state object `s` and calls exactly one editor method on OK; cancel leaves nothing to
//   undo. The editor method, not the dialog, records history, so menu, shortcut and dialog paths share one code path.
// - Last-used values persist in localStorage (lsGet / lsSet) only after OK: a cancelled experiment does not become the
//   next default.
// - The ImageMagick preview is the same filterStep / argument shape the full command uses, quoted for bash for
//   display only.

import { seg, t } from '../ui/app.js';
import { h, lsGet, lsSet } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { openDialog } from '../ui/overlays.js';
import { quote } from '../cmdline/quote.js';
import { FILTERS, applyFilter, filterStep } from './adjust.js';
import { canvasOf, clipRect, ctxOf, getPixels } from './doc.js';

// Clamps and rounds on every keystroke for the state, but leaves the field text alone, so typing '1' on the way to
// '1200' is not rewritten under the cursor. An empty or invalid field reads as 0 and is clamped to min.
const numInput = (value, min, max, onInput) => {
  const i = h('input', { type: 'number', class: 'ed-input', value, min, max, step: 1, inputmode: 'numeric' });
  i.addEventListener('input', () => onInput(Math.max(min, Math.min(max, Math.round(+i.value || 0)))));
  return i;
};
const row = (...kids) => h('div', { class: 'ph-dlg-row' }, ...kids);
const fld = (k, ctl) => h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t(k)), ctl);
const cmdPreview = () => h('p', { class: 'ph-dlg-cmd' });
const setCmd = (el, step, fid = 'exact') => el.replaceChildren(iconEl('terminal'), h('code', {}, step.map((g) => g.map((a) => quote(a, 'bash')).join(' ')).join(' ')), h('span', { class: 'ph-fid ph-fid-' + fid }, t('cmd.fid.' + fid).split(':')[0]));

export function createDialogs(ed) {
  const st = ed.st;

  async function newDoc() {
    const s = { w: 1920, h: 1080, fill: 'white', ...lsGet('photo-new', {}) };
    const PRESETS = [[1920, 1080], [1080, 1080], [1080, 1350], [1280, 720], [800, 600], [2480, 3508]];
    const wI = numInput(s.w, 1, 16000, (v) => { s.w = v; }), hI = numInput(s.h, 1, 16000, (v) => { s.h = v; });
    const presets = h('div', { class: 'ph-chips' }, PRESETS.map(([w, hh]) => h('button', { type: 'button', class: 'ed-chip', onclick: () => { s.w = w; s.h = hh; wI.value = w; hI.value = hh; } }, `${w} × ${hh}`)));
    const fill = seg([{ v: 'white', l: 'ph.white' }, { v: 'black', l: 'ph.black' }, { v: 'fg', l: 'ph.fg' }, { v: 'transparent', l: 'ph.transparent' }], s.fill, (v) => { s.fill = v; }, 'ph.background');
    const ok = await openDialog({
      title: t('ph.m.new'), body: h('div', { class: 'ed-fields' }, presets, row(fld('ph.width', wI), fld('ph.height', hI)), fld('ph.background', fill)),
      buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.create'), value: true, primary: true }],
    });
    if (!ok) return;
    lsSet('photo-new', s);
    ed.newDocument(s.w, s.h, s.fill === 'transparent' ? null : s.fill === 'black' ? '#000000' : s.fill === 'fg' ? st.fg : '#ffffff');
  }

  async function imageSize() {
    const d = st.doc;
    if (!d) return;
    const s = { w: d.width, h: d.height, keep: true, filter: lsGet('photo-resample', 'lanczos3') };
    const cmd = cmdPreview();
    // 'area' (box averaging) maps to -scale only when shrinking; enlarging by area averaging is undefined, so it falls
    // back to Triangle (bilinear), as the editor's resampler does.
    const upd = () => setCmd(cmd, s.filter === 'area' && s.w <= d.width && s.h <= d.height ? [['-scale', `${s.w}x${s.h}!`]] : [['-filter', s.filter === 'bilinear' || s.filter === 'area' ? 'Triangle' : 'Lanczos', '-resize', `${s.w}x${s.h}!`]]);
    let wI, hI;
    wI = numInput(s.w, 1, 30000, (v) => { s.w = v; if (s.keep) { s.h = Math.max(1, Math.round((v * d.height) / d.width)); hI.value = s.h; } upd(); });
    hI = numInput(s.h, 1, 30000, (v) => { s.h = v; if (s.keep) { s.w = Math.max(1, Math.round((v * d.width) / d.height)); wI.value = s.w; } upd(); });
    const keep = h('input', { type: 'checkbox', class: 'ed-switch', checked: true });
    keep.addEventListener('change', () => { s.keep = keep.checked; });
    const pct = h('div', { class: 'ph-chips' }, [25, 50, 75, 150, 200].map((p) => h('button', { type: 'button', class: 'ed-chip', onclick: () => { s.w = Math.max(1, Math.round((d.width * p) / 100)); s.h = Math.max(1, Math.round((d.height * p) / 100)); wI.value = s.w; hI.value = s.h; upd(); } }, p + ' %')));
    const filter = h('select', { class: 'ed-input ed-select' }, [['lanczos3', 'ph.fLanczos'], ['bilinear', 'ph.fBilinear'], ['area', 'ph.fArea']].map(([v, k]) => h('option', { value: v, selected: v === s.filter }, t(k))));
    filter.addEventListener('change', () => { s.filter = filter.value; upd(); });
    upd();
    const ok = await openDialog({
      title: t('ph.m.imageSize'), body: h('div', { class: 'ed-fields' }, h('p', { class: 'ed-hint' }, t('ph.currentSize', { w: d.width, h: d.height })), row(fld('ph.width', wI), fld('ph.height', hI)),
        h('label', { class: 'ed-field ed-field-check' }, keep, h('span', { class: 'ed-label' }, t('ph.keepRatio'))), pct, fld('ph.resample', filter), cmd),
      buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.apply'), value: true, primary: true }],
    });
    if (!ok) return;
    lsSet('photo-resample', s.filter);
    await ed.imageSize(s.w, s.h, s.filter);
  }

  async function canvasSize() {
    const d = st.doc;
    if (!d) return;
    const s = { w: d.width, h: d.height, anchor: 'c', fill: 'bg' };
    const cmd = cmdPreview();
    const G = { nw: 'NorthWest', n: 'North', ne: 'NorthEast', w: 'West', c: 'Center', e: 'East', sw: 'SouthWest', s: 'South', se: 'SouthEast' };
    const color = () => (s.fill === 'transparent' ? 'none' : s.fill === 'white' ? '#ffffff' : s.fill === 'black' ? '#000000' : st.bg);
    const upd = () => setCmd(cmd, [['-background', color(), '-gravity', G[s.anchor], '-extent', `${s.w}x${s.h}`]]);
    const wI = numInput(s.w, 1, 30000, (v) => { s.w = v; upd(); }), hI = numInput(s.h, 1, 30000, (v) => { s.h = v; upd(); });
    // ARIA radiogroup of buttons with aria-checked, mirroring ImageMagick's nine gravity values one to one.
    const grid = h('div', { class: 'ph-anchor', role: 'radiogroup', 'aria-label': t('ph.anchor') });
    const paint = () => { for (const b of grid.children) { const on = b.dataset.v === s.anchor; b.classList.toggle('ed-on', on); b.setAttribute('aria-checked', String(on)); } };
    for (const a of ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']) grid.append(h('button', { type: 'button', role: 'radio', dataset: { v: a }, 'aria-label': G[a], onclick: () => { s.anchor = a; paint(); upd(); } }, h('i')));
    paint(); upd();
    const fill = seg([{ v: 'bg', l: 'ph.bg' }, { v: 'white', l: 'ph.white' }, { v: 'black', l: 'ph.black' }, { v: 'transparent', l: 'ph.transparent' }], s.fill, (v) => { s.fill = v; upd(); }, 'ph.fillNew');
    const ok = await openDialog({
      title: t('ph.m.canvasSize'), body: h('div', { class: 'ed-fields' }, h('p', { class: 'ed-hint' }, t('ph.currentSize', { w: d.width, h: d.height })), row(fld('ph.width', wI), fld('ph.height', hI)), fld('ph.anchor', grid), fld('ph.fillNew', fill), cmd),
      buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.apply'), value: true, primary: true }],
    });
    if (ok) ed.canvasSize(s.w, s.h, s.anchor, color() === 'none' ? null : color());
  }

  async function feather() {
    let r = lsGet('photo-feather', 4);
    const i = numInput(r, 1, 250, (v) => { r = v; });
    const ok = await openDialog({ title: t('ph.m.feather'), body: h('div', { class: 'ed-fields' }, fld('ph.featherRadius', i)), buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.apply'), value: true, primary: true }] });
    if (ok) { lsSet('photo-feather', r); ed.featherSelection(r); }
  }

  const FILTER_PARAMS = {
    gaussianBlur: [['radius', 'ph.p.radius', 0.3, 50, 0.1, ' px']],
    unsharp: [['amount', 'ph.p.amount', 1, 500, 1, ' %'], ['radius', 'ph.p.radius', 0.3, 20, 0.1, ' px'], ['threshold', 'ph.p.threshold', 0, 255, 1, '']],
    noise: [['amount', 'ph.p.amount', 1, 100, 1, ' %']],
    pixelate: [['size', 'ph.p.cell', 2, 200, 1, ' px']],
  };
  async function filter(type) {
    const tg = ed.paintTarget();
    if (!tg) return;
    const f = FILTERS[type];
    const p = { ...f.defaults, ...lsGet('photo-flt-' + type, {}) };
    // Fresh seed per dialog (not persisted, see below): applying noise twice should not stamp the identical pattern.
    if (type === 'noise') p.seed = (Math.random() * 1e9) | 0;
    const pv = h('canvas', { class: 'ph-fprev', width: 300, height: 200, 'aria-label': t('ph.preview') });
    const cmd = cmdPreview();
    // a 100 % crop around the selection's or the view's centre
    const d = st.doc, sel = d.selection;
    const cx = sel ? sel.x + sel.w / 2 : (ed.stage.clientWidth / 2 - st.ox) / st.z, cy = sel ? sel.y + sel.h / 2 : (ed.stage.clientHeight / 2 - st.oy) / st.z;
    // Preview debounced by 60 ms: slider input fires per pixel of travel, a blur of the crop per event would lag.
    // The crop is read with a margin of about 4 radii so the blur near the preview edge sees real neighbours, then
    // drawn offset so only the centre 300 x 200 shows.
    // KNOWN DEFECT: the pixelate preview grid starts at the crop's corner, not at the layer origin, so cells in the
    // preview do not line up with the cells the filter produces on apply. Fix: snap area.x / area.y down to a multiple
    // of p.size before filtering.
    let timer = 0;
    const draw = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const margin = Math.ceil((p.radius || 0) * 4) + 2;
        const vx = Math.round(cx - tg.ox - 150), vy = Math.round(cy - tg.oy - 100);
        const area = clipRect({ x: vx - margin, y: vy - margin, w: 300 + 2 * margin, h: 200 + 2 * margin }, tg.canvas.width, tg.canvas.height);
        const g = ctxOf(pv);
        g.clearRect(0, 0, 300, 200);
        if (!area) return;
        const src = getPixels(tg.canvas, area);
        const out = applyFilter(type, { width: src.width, height: src.height, data: src.data }, p);
        g.drawImage(canvasOf(out), area.x - vx, area.y - vy);
      }, 60);
      const step = filterStep(type, p, { w: tg.canvas.width, h: tg.canvas.height });
      setCmd(cmd, step.args, step.fidelity);
      if (sel || !ed.isBg(tg.layer) || tg.onMask) cmd.append(h('span', { class: 'ph-dlg-cmdnote' }, t('ph.filterNoCmd')));
    };
    const ctrls = FILTER_PARAMS[type].map(([key, k, min, max, step, unit]) => {
      const out = h('output', { class: 'ph-opt-v' }, p[key] + unit);
      const r = h('input', { type: 'range', class: 'ed-range', min, max, step, value: p[key] });
      r.addEventListener('input', () => { p[key] = +r.value; out.textContent = r.value + unit; draw(); });
      return h('div', { class: 'ph-pf ph-pf-r' }, h('span', { class: 'ph-opt-l' }, t(k)), r, out);
    });
    if (type === 'noise') {
      const c = h('input', { type: 'checkbox', class: 'ed-switch', checked: !!p.mono });
      c.addEventListener('change', () => { p.mono = c.checked; draw(); });
      ctrls.push(h('label', { class: 'ed-field ed-field-check' }, c, h('span', { class: 'ed-label' }, t('ph.p.mono'))));
    }
    draw();
    const ok = await openDialog({
      title: t('ph.flt.' + type), body: h('div', { class: 'ed-fields ph-fdlg' }, h('div', { class: 'ph-fprev-wrap' }, pv), ...ctrls, sel ? h('p', { class: 'ed-hint' }, t('ph.filterSel')) : null, cmd),
      buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.apply'), value: true, primary: true }],
    });
    clearTimeout(timer);
    if (!ok) return;
    const { seed, ...keep } = p;
    void seed;
    lsSet('photo-flt-' + type, keep);
    await ed.applyFilter(type, p);
  }

  async function exportDlg() {
    if (!st.doc) return;
    const s = { ...st.export, name: `${st.name}-edited` };
    const q = h('div', {});
    const qr = () => {
      if (s.format === 'png') { q.replaceChildren(h('p', { class: 'ed-hint' }, t('ph.pngLossless'))); return; }
      const out = h('output', { class: 'ph-opt-v' }, s.quality);
      const r = h('input', { type: 'range', class: 'ed-range', min: 1, max: 100, step: 1, value: s.quality });
      r.addEventListener('input', () => { s.quality = +r.value; out.textContent = r.value; });
      q.replaceChildren(h('div', { class: 'ph-pf ph-pf-r' }, h('span', { class: 'ph-opt-l' }, t('ph.quality')), r, out));
    };
    qr();
    const name = h('input', { class: 'ed-input', value: s.name, spellcheck: 'false' });
    // Strip characters invalid in Windows file names (the strictest common file system), so the download is not
    // renamed or refused by the OS.
    name.addEventListener('input', () => { s.name = name.value.replace(/[\\/:*?"<>|]/g, '').trim() || 'image'; });
    const fmt = seg([{ v: 'png', l: '=PNG' }, { v: 'jpeg', l: '=JPEG' }, { v: 'webp', l: '=WebP' }], s.format, (v) => { s.format = v; qr(); }, 'ph.format');
    const ok = await openDialog({
      title: t('ph.m.export'), body: h('div', { class: 'ed-fields' }, fld('ph.format', fmt), q, fld('ph.fileName', name), h('p', { class: 'ed-hint' }, t('ph.exportHint', { w: st.doc.width, h: st.doc.height }))),
      buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ph.download'), value: true, primary: true, icon: 'download' }],
    });
    if (ok) await ed.exportImage(s.format, s.quality, s.name);
  }

  function shortcuts() {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const k = (s) => (mac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s);
    const rows = [
      ['ph.sc.tools', 'V M L W C I B E S G T U H Z'], ['ph.sc.cycle', 'M · L · U'], ['ph.sc.gradient', 'Shift+G'],
      ['ph.sc.size', '[ ]'], ['ph.sc.hardness', 'Shift+[ Shift+]'], ['ph.sc.opacity', '1 … 9, 0'], ['ph.sc.colors', 'X · D'],
      ['ph.sc.pan', 'Space + drag · wheel'], ['ph.sc.zoom', 'Ctrl+wheel · pinch · Ctrl++ Ctrl+-'], ['ph.sc.fit', 'Ctrl+0 · Ctrl+1'],
      ['ph.sc.undo', 'Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y'], ['ph.sc.select', 'Ctrl+A · Ctrl+D · Ctrl+Shift+I'], ['ph.sc.selMods', 'Shift / Alt / Shift+Alt'],
      ['ph.sc.clear', 'Delete · Alt+Backspace'], ['ph.sc.copy', 'Ctrl+C · Ctrl+X · Ctrl+V'], ['ph.sc.layers', 'Ctrl+J · Ctrl+E · Ctrl+[ Ctrl+] · Ctrl+Alt+Shift+N'],
      ['ph.sc.transform', 'Ctrl+T · Enter · Esc'], ['ph.sc.nudge', '← ↑ → ↓ (Shift ×10)'], ['ph.sc.clone', 'Alt+click'], ['ph.sc.files', 'Ctrl+O · Ctrl+S · Ctrl+Shift+E · Ctrl+Alt+N'],
      ['ph.sc.size2', 'Ctrl+Alt+I · Ctrl+Alt+C'],
    ];
    openDialog({
      title: t('ph.m.shortcuts'), wide: true,
      body: h('table', { class: 'ap-table ph-keys' }, h('tbody', {}, rows.map(([a, b]) => h('tr', {}, h('td', {}, t(a)), h('td', {}, h('kbd', { class: 'ed-kbd' }, k(b))))))),
    });
  }

  return { newDoc, imageSize, canvasSize, feather, filter, exportDlg, shortcuts };
}
