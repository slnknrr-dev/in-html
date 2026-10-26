// pallete-app/strip.js - the palette strip: big swatches with value (hex / rgb / hsl / oklch), name, copy,
// lock, set as base, reorder (drag, buttons, Shift+arrows), remove; keyboard navigation between swatches.
//
// Rendering contract: the strip is rebuilt from S on every change (renderStrip clears its host); state changes go
// through state.js operations and ctx.changed(kind, focusIndex), which re-renders the app and puts focus back on the
// swatch that moved or changed, so keyboard users never lose their place after a rebuild.
// Accessibility model: list > listitem per swatch; the focusable "face" is a group with a roledescription ("swatch")
// and a full spoken label (position, value, name, locked). Every mouse action has a button and a key.
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { formatCSS, fromHex } from '../color/css.js';
import { S, info, moveColor, removeColor, toggleLock, cycleFormat } from './state.js';

const FMT_LABEL = { hex: 'HEX', rgb: 'RGB', hsl: 'HSL', oklch: 'OKLCH' };

// Text of a swatch in its display format.
export const valueOf = (c) => (c.fmt === 'hex' ? c.hex.toUpperCase() : formatCSS(fromHex(c.hex), c.fmt));

/**
 * Renders the strip into `host`. ctx: { changed(kind), copy(text), setBase(hex), focusIndex } — changed() re-renders
 * the application after an edit; focusIndex (if set) receives the focus after rendering.
 */
export function renderStrip(host, ctx) {
  host.textContent = '';
  const n = S.colors.length;
  // Many swatches (> 7): compact variant via a class, so CSS shrinks text and tools.
  const strip = h('div', { class: 'pal-strip' + (n > 7 ? ' pal-many' : ''), role: 'list', 'aria-label': t('pal.palette') });
  let dragFrom = -1;
  S.colors.forEach((c, i) => {
    const f = info(c.hex);
    const val = valueOf(c);
    const name = c.name || f.name;
    // Tool buttons stop propagation: their clicks must not reach the face, whose click copies the value.
    const tool = (ic, label, fn, extra = {}) => h('button', {
      type: 'button', class: 'pal-tool' + (extra.on ? ' pal-on' : ''), title: label, 'aria-label': label,
      'aria-pressed': extra.pressed, disabled: extra.disabled, onclick: (e) => { e.stopPropagation(); fn(); },
    }, iconEl(ic));
    const face = h('div', {
      class: 'pal-face', tabindex: '0', role: 'group', dataset: { i: String(i) },
      'aria-roledescription': t('pal.swatch'),
      'aria-label': t('pal.swatchAria', { i: i + 1, n, v: val, name }) + (c.locked ? ' · ' + t('pal.locked') : ''),
      title: t('pal.clickCopy'),
      onclick: () => ctx.copy(val),
    });
    const sw = h('div', {
      class: 'pal-sw' + (c.locked ? ' pal-locked' : ''), role: 'listitem', draggable: 'true', dataset: { i: String(i) },
      // Colour and label colour as custom properties: app.css paints everything from --c / --ink. The hex is validated
      // by state.js (#rrggbb), so interpolating it into the style string cannot inject other declarations.
      style: `--c:${c.hex};--ink:${f.ink}`,
    },
    face,
    h('div', { class: 'pal-info' },
      // A user name (import) shows the nearest CSS colour name as tooltip, and vice versa.
      h('span', { class: 'pal-name', title: c.name ? f.name : t('pal.nearestName') }, name),
      h('span', { class: 'pal-val' }, val),
      h('button', {
        type: 'button', class: 'pal-fmt', title: t('pal.fmtToggle'), 'aria-label': t('pal.fmtToggle') + ': ' + FMT_LABEL[c.fmt],
        onclick: (e) => { e.stopPropagation(); cycleFormat(i); ctx.changed('fmt', i); },
      }, FMT_LABEL[c.fmt])),
    h('div', { class: 'pal-tools' },
      tool(c.locked ? 'lock' : 'unlock', t(c.locked ? 'pal.unlock' : 'pal.lock'), () => { toggleLock(i); ctx.changed('lock', i); }, { on: c.locked, pressed: String(!!c.locked) }),
      tool('target', t('pal.setBase'), () => ctx.setBase(c.hex)),
      tool('copy', t('pal.copy'), () => ctx.copy(val)),
      tool('chevLeft', t('pal.moveLeft'), () => { if (moveColor(i, i - 1)) ctx.changed('move', i - 1); }, { disabled: i === 0 }),
      tool('chevRight', t('pal.moveRight'), () => { if (moveColor(i, i + 1)) ctx.changed('move', i + 1); }, { disabled: i === n - 1 }),
      tool('trash', t('pal.remove'), () => { if (removeColor(i)) ctx.changed('remove', Math.min(i, S.colors.length - 1)); }, { disabled: n <= 1 }),
    ),
    c.locked ? h('span', { class: 'pal-lockmark', 'aria-hidden': 'true' }, iconEl('lock')) : null);
    // Drag to reorder (the drop position follows the pointer half of the target swatch).
    sw.addEventListener('dragstart', (e) => {
      dragFrom = i;
      sw.classList.add('pal-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // setData is required for Firefox to start a drag at all; wrapped because some browsers throw for certain types.
      try { e.dataTransfer.setData('text/plain', c.hex); } catch { /* some browsers */ }
    });
    sw.addEventListener('dragend', () => { sw.classList.remove('pal-dragging'); clearMarks(strip); });
    sw.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      clearMarks(strip);
      sw.classList.add(after(e, sw) ? 'pal-drop-after' : 'pal-drop-before');
    });
    sw.addEventListener('drop', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      // Drop index: before or after the target by pointer half; when moving right, removing the source first shifts the
      // target index down by one.
      let to = i + (after(e, sw) ? 1 : 0);
      if (dragFrom < to) to--;
      const from = dragFrom;
      dragFrom = -1;
      clearMarks(strip);
      if (moveColor(from, to)) ctx.changed('move', to);
    });
    strip.append(sw);
  });
  // One delegated keydown listener for the whole strip.
  strip.addEventListener('keydown', (e) => onKey(e, ctx));
  host.append(strip);
  if (ctx.focusIndex != null) {
    // preventScroll: re-focusing after a rebuild must not jump the page.
    const el = strip.querySelector(`.pal-face[data-i="${Math.min(ctx.focusIndex, n - 1)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  return strip;
}

// The strip is vertical on phones (app.css breakpoint 640px), so "after" is measured along the matching axis.
const vertical = () => window.matchMedia('(max-width: 640px)').matches;
function after(e, el) {
  const r = el.getBoundingClientRect();
  return vertical() ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
}
function clearMarks(strip) {
  for (const el of strip.querySelectorAll('.pal-drop-before, .pal-drop-after')) el.classList.remove('pal-drop-before', 'pal-drop-after');
}

// Keys on a focused swatch: arrows move the focus (Shift+arrows move the swatch), Home / End, Enter or C copies,
// L locks, B sets the base, F cycles the format, Delete / Backspace removes.
function onKey(e, ctx) {
  const face = e.target.closest?.('.pal-face');
  // Modifier combinations are left to the browser and the global shortcuts.
  if (!face || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = +face.dataset.i;
  const n = S.colors.length;
  const c = S.colors[i];
  const k = e.key;
  const prev = ['ArrowLeft', 'ArrowUp'].includes(k);
  const next = ['ArrowRight', 'ArrowDown'].includes(k);
  let handled = true;
  if ((prev || next) && e.shiftKey) {
    const to = i + (next ? 1 : -1);
    if (moveColor(i, to)) ctx.changed('move', to);
  } else if (prev || next || k === 'Home' || k === 'End') {
    const to = k === 'Home' ? 0 : k === 'End' ? n - 1 : Math.min(n - 1, Math.max(0, i + (next ? 1 : -1)));
    face.closest('.pal-strip').querySelector(`.pal-face[data-i="${to}"]`)?.focus();
  } else if (k === 'Enter' || k === 'c' || k === 'C') ctx.copy(valueOf(c));
  else if (k === 'l' || k === 'L') { toggleLock(i); ctx.changed('lock', i); }
  else if (k === 'b' || k === 'B') ctx.setBase(c.hex);
  else if (k === 'f' || k === 'F') { cycleFormat(i); ctx.changed('fmt', i); }
  else if (k === 'Delete' || k === 'Backspace') { if (removeColor(i)) ctx.changed('remove', Math.min(i, S.colors.length - 1)); }
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}
