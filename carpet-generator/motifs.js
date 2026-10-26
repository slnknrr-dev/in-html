// carpet-generator/motifs.js - the motif editor and the user's motif library (localStorage): paint a motif with colour
// roles on a grid (mirrored left–right and / or top–bottom while painting), start from a library motif, name it,
// choose whether it is a field or a border motif, save; saved motifs appear in the design options.
//
//   userMotifs() -> [motif]        openMotifEditor({ onSave })
//
// Data model: a motif is rows of characters, one per cell; '.' = transparent, letters = colour roles via CHAR_ROLE
// (A-D accents, O outline, L light, G ground). Roles, not colours: a motif re-colours with any palette. The editor
// works on a 2D char array (mutable per cell) and joins rows only on save.
// Storage: localStorage key 'cg-motifs', read fresh on every userMotifs() call (no cache), so the editor, the
// selects and the layer panel always agree after a save or delete. normMotif on read guards against old/corrupt data.

import { h, lsGet, lsSet } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { seg, select, toggle, button } from '../ui/app.js';
import { openDialog, toast, confirmDialog } from '../ui/overlays.js';
import { MOTIFS, CHAR_ROLE, normMotif, motifSize } from '../carpet/motifs.js';
import { paletteColors } from '../carpet/dyes.js';

export const userMotifs = () => (lsGet('cg-motifs', []) || []).map(normMotif);
const saveMotifs = (list) => lsSet('cg-motifs', list);

// The editor previews in the Persian palette regardless of the current rug: a stable, high-contrast reference set.
// New ids are base-36 timestamps: unique per user without a counter in storage.
export function openMotifEditor({ onSave } = {}) {
  const colors = Object.fromEntries(paletteColors('persian').map((c) => [c.role, c.hex]));
  let m = { id: 'u' + Date.now().toString(36), name: t('me.untitled'), kind: 'field', w: 15, h: 15, cells: Array.from({ length: 15 }, () => '.'.repeat(15).split('')) };
  let brush = 'A', mx = true, my = true;
  const cv = h('canvas', { class: 'cg-me-canvas' });
  const nameIn = h('input', { class: 'ed-input', value: m.name });
  nameIn.addEventListener('input', () => { m.name = nameIn.value; });
  const CELL = 18;
  // Full redraw per change (at most 31x31 cells: trivial). Setting canvas width/height clears it and resets context
  // state. Grid lines at +0.5: a 1px line centred on a pixel boundary would straddle two pixels and blur into 2px.
  // The red lines mark the active mirror axes.
  function draw() {
    cv.width = m.w * CELL; cv.height = m.h * CELL;
    const g = cv.getContext('2d');
    g.fillStyle = colors.field; g.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const c = m.cells[y][x];
      if (c !== '.') { g.fillStyle = colors[CHAR_ROLE[c]] || '#888'; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
    }
    g.strokeStyle = 'rgba(0,0,0,.25)';
    g.lineWidth = 1;
    for (let x = 0; x <= m.w; x++) { g.beginPath(); g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, cv.height); g.stroke(); }
    for (let y = 0; y <= m.h; y++) { g.beginPath(); g.moveTo(0, y * CELL + 0.5); g.lineTo(cv.width, y * CELL + 0.5); g.stroke(); }
    g.strokeStyle = 'rgba(200,30,30,.6)';
    if (mx) { g.beginPath(); g.moveTo(cv.width / 2, 0); g.lineTo(cv.width / 2, cv.height); g.stroke(); }
    if (my) { g.beginPath(); g.moveTo(0, cv.height / 2); g.lineTo(cv.width, cv.height / 2); g.stroke(); }
  }
  // Mirror painting: the cell plus its reflections (and the point reflection when both axes are on, which closes the
  // 4-fold set). Duplicates on the axis itself are harmless (same value written twice).
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
    const pts = [[x, y]];
    if (mx) pts.push([m.w - 1 - x, y]);
    if (my) pts.push([x, m.h - 1 - y]);
    if (mx && my) pts.push([m.w - 1 - x, m.h - 1 - y]);
    for (const [a, b] of pts) m.cells[b][a] = brush;
    draw();
  };
  // Pointer -> cell via the rendered rect, not CELL: CSS max-width:100% may scale the canvas down on narrow screens.
  // setPointerCapture keeps the stroke going when the pointer leaves the canvas; touch-action:none stops the browser
  // from turning a finger drag into a scroll. Only pointerup clears `down` (no pointercancel listener): harmless,
  // because the next stroke starts with pointerdown anyway.
  let down = false;
  const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.floor(((e.clientX - r.left) / r.width) * m.w), Math.floor(((e.clientY - r.top) / r.height) * m.h)]; };
  cv.addEventListener('pointerdown', (e) => { down = true; try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } paint(...at(e)); });
  cv.addEventListener('pointermove', (e) => { if (down) paint(...at(e)); });
  cv.addEventListener('pointerup', () => { down = false; });
  cv.style.touchAction = 'none';
  const brushes = [['A', 'accent1'], ['B', 'accent2'], ['C', 'accent3'], ['D', 'accent4'], ['O', 'outline'], ['L', 'light'], ['G', 'ground'], ['.', 'erase']];
  const brushSeg = seg(brushes.map(([c, r]) => ({ v: c, l: r === 'erase' ? 'me.erase' : 'role.' + r })), brush, (v) => { brush = v; }, 'me.brush');
  // Odd sizes only: an odd grid has a centre cell, so mirrored motifs get a true axis row/column (traditional knotted
  // motifs are drawn this way). Resize keeps the top-left content and pads with '.'.
  const sizeSel = select([7, 9, 11, 13, 15, 17, 21, 25, 31].map((v) => ({ v, l: '=' + v + ' × ' + v })), m.w, (v) => {
    const n = +v;
    m.cells = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (m.cells[y] && m.cells[y][x]) || '.'));
    m.w = m.h = n;
    draw();
  });
  // Start from a library or user motif. Library motifs are copied under the new id (saving makes a new user motif);
  // a user motif keeps its id and name, so saving overwrites it, which is how editing an existing motif works.
  // kindSeg is referenced before its const line; safe because this callback runs only after construction.
  const fromSel = select([{ v: '', l: 'me.fromNone' }, ...Object.values(MOTIFS).map((x) => ({ v: x.id, l: 'motif.' + x.id })), ...userMotifs().map((x) => ({ v: 'user:' + x.id, l: '=' + x.name }))], '', (v) => {
    if (!v) return;
    const src = v.startsWith('user:') ? userMotifs().find((x) => x.id === v.slice(5)) : MOTIFS[v];
    if (!src) return;
    const s = motifSize(src);
    m.w = s.w; m.h = s.h; m.kind = src.kind;
    m.cells = src.rows.map((r) => r.padEnd(s.w, '.').split(''));
    if (v.startsWith('user:')) { m.id = src.id; m.name = src.name; nameIn.value = src.name; }
    kindSeg.set(m.kind);
    draw();
  });
  const kindSeg = seg([{ v: 'field', l: 'me.field' }, { v: 'border', l: 'me.border' }], m.kind, (v) => { m.kind = v; }, 'me.kind');
  const mine = h('div', { class: 'cg-me-mine' });
  function renderMine() {
    mine.textContent = '';
    for (const u of userMotifs()) mine.append(h('span', { class: 'ed-chip' }, u.name, h('button', { type: 'button', class: 'ed-iconbtn', title: t('me.delete'), onclick: async () => { if (await confirmDialog(t('me.delete'), t('me.deleteQ', { name: u.name }), t('me.delete'), true)) { saveMotifs(userMotifs().filter((x) => x.id !== u.id)); renderMine(); onSave && onSave(); } } }, iconEl('close'))));
  }
  renderMine();
  const body = h('div', { class: 'cg-me' },
    h('div', { class: 'cg-me-tools' },
      h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.name')), nameIn),
      h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.kind')), kindSeg),
      h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.size')), sizeSel),
      h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.from')), fromSel),
      h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.brush')), brushSeg),
      h('label', { class: 'ed-field ed-field-check' }, toggle(mx, (v) => { mx = v; draw(); }), h('span', { class: 'ed-label' }, t('me.mirrorX'))),
      h('label', { class: 'ed-field ed-field-check' }, toggle(my, (v) => { my = v; draw(); }), h('span', { class: 'ed-label' }, t('me.mirrorY'))),
      button('me.clear', 'trash', () => { m.cells = m.cells.map((r) => r.map(() => '.')); draw(); }),
      h('div', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('me.mine')), mine)),
    h('div', { class: 'cg-me-board' }, cv, h('p', { class: 'ed-hint' }, t('me.hint'))));
  draw();
  // Save on the primary button only; an all-transparent motif is refused (it would stamp nothing). Save = filter out
  // the same id, then push: an upsert that also moves the edited motif to the end of the list.
  return openDialog({ title: t('cg.motifEditor'), body, wide: true, className: 'cg-me-dlg', buttons: [{ label: t('dlg.close'), value: null }, { label: t('me.save'), value: 'ok', primary: true }] }).then((v) => {
    if (v !== 'ok') return null;
    const motif = normMotif({ id: m.id, name: m.name || t('me.untitled'), kind: m.kind, rows: m.cells.map((r) => r.join('')) });
    if (!motif.rows.some((r) => /[^.]/.test(r))) { toast(t('me.empty'), 'warn'); return null; }
    const list = userMotifs().filter((x) => x.id !== motif.id);
    list.push(motif);
    saveMotifs(list);
    toast(t('me.saved', { name: motif.name }), 'ok');
    if (onSave) onSave(motif);
    return motif;
  });
}
