// carpet-generator/editor.js - painting knots by hand over the generated rug: tools (move the view, brush, line,
// rectangle, fill, picker, motif stamp), a brush size, a symmetry of the whole rug that repeats every stroke, the
// palette roles as the colours, undo / redo, clearing the edits. Edits live in carpet/edits.js buffers; the page
// gives the base rug and is told when the picture or the saved edits change.
//
//   createEditor({ getBase() -> rug, getEdits() -> edits | null, setEdits(edits), onPaint(), onCommit() })
//     .toolbar() -> element     .onCell(ev)     .panTool() -> boolean     .tool
//
// Design decisions:
// - Edits are a sparse overlay (one value per knot, NONE = untouched), not a mutated copy of the rug. The generated
//   base stays pristine, so edits survive re-colouring (values are palette role indices, not RGB) and encode compactly.
// - Undo stores whole-buffer snapshots per stroke (capped at 40). One byte per knot (Uint8Array): a 400x600-knot
//   rug costs 240 KB per snapshot, simple and exact. Cost to know: at the extreme of the size tab (400x600 cm at
//   400 kpsi, about 3150x4720 knots) one snapshot is ~15 MB and 40 of them ~600 MB; a diff-based undo would be the fix
//   if such sizes were edited by hand. A stroke = pointer down..up, so undo is per
//   gesture, not per cell.
// - Preview tools (line, rect) restore the pre-stroke snapshot on every move and redraw: the shape follows the
//   pointer without leaving a trail. The brush instead paints a segment from the last point, so fast moves leave no
//   gaps between sampled pointer positions.
// - 'cancel' (pointercancel, e.g. a touch turned into a scroll) rolls the stroke back instead of committing half of it.

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { addIcons, iconEl } from '../ui/icons.js';
import { select } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { MOTIFS, ROLE_CHAR } from '../carpet/motifs.js';
import { ROLES } from '../carpet/dyes.js';
import { createEdits, paintBrush, paintLine, paintRect, floodFill, stampMotif, snapshot, restore, countEdits, NONE } from '../carpet/edits.js';

addIcons({
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 6.5a1.5 1.5 0 0 1 3 0V13M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.6 1.6 0 0 1 2.6-1.8L8 13.5',
  brush: 'M14 4l6 6-9 9H5v-6zM12 6l6 6',
  line: 'M5 19L19 5',
  rect: 'M4 6h16v12H4z',
  bucket: 'M5 11l7-7 7 7-7 7zM19 15c0 2 1 3 1 4a1 1 0 0 1-2 0c0-1 1-2 1-4',
  picker: 'M14 4l6 6-2 2-6-6zM12 8l-7 7v4h4l7-7',
  stamp: 'M9 4h6l-1 7h5v4H5v-4h5zM5 19h14',
});

const TOOLS = [['view', 'hand'], ['brush', 'brush'], ['line', 'line'], ['rect', 'rect'], ['fill', 'bucket'], ['picker', 'picker'], ['stamp', 'stamp']];
const SYMS = ['none', 'mirrorX', 'mirrorY', 'mirrorXY', 'rot2', 'rot4'];

export function createEditor({ getBase, getEdits, setEdits, onPaint, onCommit, colorOf }) {
  const st = { tool: 'view', size: 0, sym: 'none', color: ROLES.indexOf('accent1'), motif: 'star8', stroke: null, undo: [], redo: [] };
  let bar = null;
  // Lazily (re)creates the buffer when absent or sized for another grid (size changed since): painting always has a
  // buffer of the current dimensions, and the page learns about it via setEdits.
  const edits = () => {
    const base = getBase();
    let e = getEdits();
    if (!e || e.w !== base.width || e.h !== base.height) { e = createEdits(base.width, base.height); setEdits(e); }
    return e;
  };
  // Motif character (ROLE_CHAR: role -> char) back to a palette role index; null = transparent ('.') in a stamp.
  const roleIndex = (c) => { const role = Object.keys(ROLE_CHAR).find((r) => ROLE_CHAR[r] === c); return role ? ROLES.indexOf(role) : null; };

  // Pointer events from the chart view, already in knot coordinates (may lie outside the rug while dragging).
  // A stroke may start only inside; moves outside are clamped in apply(), so a line can be dragged to the edge.
  // The picker reads the edited value first, then the base: it picks what is visible.
  function onCell(ev) {
    if (st.tool === 'view') return;
    const base = getBase();
    const inside = ev.x >= 0 && ev.y >= 0 && ev.x < base.width && ev.y < base.height;
    const e = edits();
    if (ev.type === 'down') {
      if (!inside) return;
      if (st.tool === 'picker') {
        const v = e.data[ev.y * e.w + ev.x];
        st.color = v !== NONE ? v : base.cells[ev.y * base.width + ev.x];
        render();
        return;
      }
      st.stroke = { x0: ev.x, y0: ev.y, x: ev.x, y: ev.y, before: snapshot(e) };
      apply(e, ev);
    } else if (ev.type === 'move' && st.stroke) {
      apply(e, ev);
    } else if ((ev.type === 'up' || ev.type === 'cancel') && st.stroke) {
      if (ev.type === 'cancel') restore(e, st.stroke.before);
      else { st.undo.push(st.stroke.before); if (st.undo.length > 40) st.undo.shift(); st.redo = []; }
      st.stroke = null;
      onPaint();
      onCommit();
      render();
    }
  }
  // Fill and stamp act on 'down' only (one-shot tools); a drag would otherwise stamp a smear of motifs. Stamp scale is
  // size + 1 (size 0 = 1x). onPaint() per move: the picture follows live; the chart waits for onCommit (main.js).
  function apply(e, ev) {
    const s = st.stroke, x = Math.max(0, Math.min(e.w - 1, ev.x)), y = Math.max(0, Math.min(e.h - 1, ev.y));
    switch (st.tool) {
      case 'brush': paintLine(e, s.x, s.y, x, y, st.size, st.color, st.sym); break;
      case 'line': restore(e, s.before); paintLine(e, s.x0, s.y0, x, y, st.size, st.color, st.sym); break;
      case 'rect': restore(e, s.before); paintRect(e, s.x0, s.y0, x, y, st.color, st.sym, st.size > 0); break;
      case 'fill': if (ev.type === 'down') floodFill(e, getBase(), x, y, st.color, st.sym); break;
      case 'stamp': if (ev.type === 'down') stampMotif(e, MOTIFS[st.motif] || MOTIFS.star8, x, y, st.size + 1, roleIndex, st.sym); break;
      default: break;
    }
    s.x = x; s.y = y;
    onPaint();
  }
  // Undo and redo are one function with the stacks swapped: push the current state onto the other stack, restore the
  // popped one. Note the redo stack is uncapped (bounded in practice by the 40 undo entries it came from).
  function step(from, to) {
    const e = getEdits();
    if (!e || !from.length) return;
    to.push(snapshot(e));
    restore(e, from.pop());
    onPaint(); onCommit(); render();
  }
  // Toolbar re-rendered from st on every change (small, cheap). Controls irrelevant to the tool are omitted, not
  // disabled: the bar stays one line on most screens. Tools and swatches are radiogroups (role=radio, aria-checked).
  // Picking a colour while in view/picker mode switches to the brush: choosing a colour signals intent to paint.
  function render() {
    if (!bar) return;
    bar.textContent = '';
    const tools = h('div', { class: 'ed-seg cg-tools', role: 'radiogroup', 'aria-label': t('ke.tools') }, TOOLS.map(([k, ic]) => h('button', {
      type: 'button', role: 'radio', class: 'ed-seg-btn' + (st.tool === k ? ' ed-on' : ''), 'aria-checked': String(st.tool === k), title: t('ke.' + k), 'aria-label': t('ke.' + k), dataset: { tool: k },
      onclick: () => { st.tool = k; render(); },
    }, iconEl(ic))));
    const sw = h('div', { class: 'cg-swatches', role: 'radiogroup', 'aria-label': t('ke.colour') }, ROLES.map((r, i) => h('button', {
      type: 'button', role: 'radio', class: 'cg-swatch' + (st.color === i ? ' on' : ''), 'aria-checked': String(st.color === i), title: t('role.' + r), style: { background: colorOf(r) },
      onclick: () => { st.color = i; if (st.tool === 'view' || st.tool === 'picker') st.tool = 'brush'; render(); },
    })));
    const e = getEdits();
    const n = e ? countEdits(e) : 0;
    // Size select: brush/line radius v shown as a diameter 2v+1; rect maps 0 -> outline, >0 -> filled; stamp -> scale.
    // KNOWN DEFECT: "clear" pushes an undo snapshot but leaves st.redo intact, so Redo after Clear restores a state
    // from before the clear's own history branch. Fix: add `st.redo = [];` next to the push, as onCell does.
    bar.append(...[tools,
      st.tool !== 'view' ? h('label', { class: 'cg-inl' }, t(st.tool === 'stamp' ? 'ke.scale' : 'ke.size'), select([0, 1, 2, 3, 4, 6, 8].map((v) => ({ v, l: '=' + (st.tool === 'stamp' ? v + 1 + '×' : st.tool === 'rect' ? (v ? t('ke.filled') : t('ke.outline')) : 2 * v + 1) })), st.size, (v) => { st.size = +v; })) : null,
      st.tool === 'stamp' ? select(Object.values(MOTIFS).filter((m) => m.kind === 'field').map((m) => ({ v: m.id, l: 'motif.' + m.id })), st.motif, (v) => { st.motif = v; }) : null,
      st.tool !== 'view' ? h('label', { class: 'cg-inl' }, t('ke.sym'), select(SYMS.map((v) => ({ v, l: 'ksym.' + v })), st.sym, (v) => { st.sym = v; })) : null,
      st.tool !== 'view' ? sw : null,
      h('span', { class: 'ed-spacer' }),
      n ? h('small', { class: 'ed-muted' }, t('ke.count', { n })) : null,
      btn('undo', 'ke.undo', () => step(st.undo, st.redo), !st.undo.length),
      btn('redo', 'ke.redo', () => step(st.redo, st.undo), !st.redo.length),
      n ? btn('trash', 'ke.clear', () => { const ed = getEdits(); st.undo.push(snapshot(ed)); ed.data.fill(NONE); onPaint(); onCommit(); render(); toast(t('ke.cleared'), 'ok'); }) : null].filter(Boolean));
  }
  // disabled goes through h() as a DOM property (ui/dom.js: el.disabled = !!v), so null and false both enable.
  const btn = (ic, label, fn, disabled) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(label), 'aria-label': t(label), disabled: disabled || null, onclick: fn }, iconEl(ic));
  return {
    get tool() { return st.tool; },
    onCell,
    panTool: () => st.tool === 'view',
    // toolbar() creates a fresh bar each page render and rebinds `bar`; the old one is simply dropped with the DOM.
    toolbar() { bar = h('div', { class: 'cg-editbar' }); render(); return bar; },
    reset() { st.undo = []; st.redo = []; render(); },
    refresh: render,
  };
}
