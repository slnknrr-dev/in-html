// miner-game/input.js - board input: mouse (left reveal, right flag, middle or both buttons chord, drag to
// pan, wheel to zoom), touch and pen (tap, long press for the other action with a short vibration, one-finger pan,
// pinch zoom) and the keyboard (arrows move a cursor, Enter / Space reveal or chord, F flag, C chord, the Menu key or
// Shift+F10 open the actions of the cell). The browser's own menu, the touch callout and text selection never
// appear over the board: the right button and the long press are game input.
//
// bindInput(canvas, board, ctl) - ctl: {
//   playable()         input may change the game (not replaying, not generating)
//   primary(i)         tap / left click: reveal, chord on an open number, or flag in flag mode
//   secondary(i)       right click / long press: flag (question mark), chord on an open number, or reveal in flag mode
//   chord(i)           middle click / both buttons
//   isOpen(i)          the cell is open (a right press there waits for a both-button chord)
//   preview(i, chord)  cells that look pressed while a button is held
//   pressing(on)       a button is held over the board (the face looks surprised)
//   longPress()        long-press delay in ms
//   vibrate()          haptic tick after a long press
//   announce(i)        the keyboard cursor moved to cell i
//   menu(i, x, y)      the Menu key / Shift+F10: actions of cell i at client point (x, y)
//   key(e)             other keys (returns true when handled)
// }

// Design: one gesture state object (st) at a time, discriminated by kind ('mouse' | 'touch' | 'pinch'). Mouse and pen
// share the button logic; touch is tracked per pointerId so a second finger turns a tap into a pinch. All game
// effects go through ctl, so this module knows geometry (board) and gestures, never game rules - which keeps it
// testable and lets replays simply report playable() = false.
import { OPEN } from '../mines/game.js';

// Slop thresholds: a press that moves less than this is still a click. Fingers jitter more than mice, hence the
// larger touch/pen value; too small and taps become accidental pans, too large and panning feels sticky.
const PAN_SLOP = 7; // CSS px before a press turns into a pan
const TOUCH_SLOP = 11;
// e.button -> its bit in e.buttons (left, middle, right, back, forward)
const BUTTON_BIT = [1, 4, 2, 8, 16];
// navigator.platform is deprecated but still the most reliable Mac signal; userAgent is the fallback.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export function bindInput(canvas, board, ctl) {
  const touches = new Map(); // pointerId -> { x, y }
  let st = null; // current gesture
  let cursor = -1;

  // Client -> canvas CSS coordinates. getBoundingClientRect per event: the canvas can move (sheet, resize) and a
  // cached rect would go stale; the call is cheap relative to a redraw.
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const cellAt = (p) => board.cellAt(p.x, p.y);

  function setPreview(cell, chord) {
    if (!ctl.playable() || cell < 0) { board.setPressed(null); return; }
    board.setPressed(ctl.preview(cell, chord));
  }
  function endPress() { board.setPressed(null); ctl.pressing(false); }

  // A finger or a pen held still: the other action (flag, or open in flag mode) with a short vibration.
  // The timer re-checks that its gesture is still current (st === s) and did not turn into a pan or fire already:
  // cancelling every path that ends a gesture is error-prone; a guard at fire time is robust.
  function startLongPress(s) {
    if (!ctl.playable() || s.cell < 0) return;
    s.timer = setTimeout(() => {
      if (st !== s || s.pan || s.done) return;
      s.done = true;
      endPress();
      ctl.vibrate();
      ctl.secondary(s.cell);
    }, ctl.longPress());
  }

  // --- mouse and pen ----------------------------------------------------------------------------------------------
  // Pointer Events report a second button pressed (or one of two released) as a pointermove with e.button set:
  // pointerdown / pointerup come only for the first press and the last release.
  function mouseDown(e) {
    const p = pos(e), cell = cellAt(p);
    board.setCursor(cursor, false);
    if (st && st.kind === 'mouse') { buttonDown(e, cell); return; }
    // Control-click is the right button on a Mac (one-button mice and trackpads).
    const btn = e.button === 0 && e.ctrlKey && MAC ? 2 : e.button;
    st = { kind: 'mouse', pen: e.pointerType === 'pen', btn, x0: p.x, y0: p.y, x: p.x, y: p.y, cell, pan: false, chord: btn === 1, done: false, timer: 0 };
    if (btn === 2) {
      // Flag at once (classic feel). On an open number the right button waits: with the left one it chords, alone it
      // chords on release.
      if (cell >= 0 && ctl.isOpen(cell)) { if (ctl.playable()) { ctl.pressing(true); setPreview(cell, true); } return; }
      if (ctl.playable() && cell >= 0) ctl.secondary(cell);
      st.done = true;
      return;
    }
    if (btn !== 0 && btn !== 1) { st.done = true; return; } // back / forward / eraser buttons
    if (ctl.playable()) { ctl.pressing(true); setPreview(cell, st.chord); }
    if (st.pen && btn === 0) startLongPress(st);
  }

  // Another button pressed while one is held: left + right chord.
  function buttonDown(e, cell) {
    const s = st;
    clearTimeout(s.timer);
    if (s.pan || !((s.btn === 0 && e.button === 2) || (s.btn === 2 && e.button === 0))) return;
    s.chord = true;
    s.done = false;
    s.cell = cell;
    if (ctl.playable()) { ctl.pressing(true); setPreview(cell, true); }
  }

  // One of two buttons released: a both-button chord fires now, the other release is ignored.
  function buttonUp(e, cell) {
    const s = st;
    if (s.chord && !s.done && !s.pan) { endPress(); if (cell >= 0 && ctl.playable()) ctl.chord(cell); }
    s.done = true;
  }

  function mouseMove(e) {
    const p = pos(e);
    if (!st || st.kind !== 'mouse') { board.setHover(cellAt(p)); return; }
    if (e.button >= 0 && e.button < BUTTON_BIT.length) {
      const cell = cellAt(p);
      if (e.buttons & BUTTON_BIT[e.button]) buttonDown(e, cell); else buttonUp(e, cell);
      return;
    }
    const dx = p.x - st.x, dy = p.y - st.y;
    st.x = p.x; st.y = p.y;
    if (!st.pan && !st.chord && st.btn !== 2 && Math.hypot(p.x - st.x0, p.y - st.y0) > (st.pen ? TOUCH_SLOP : PAN_SLOP)) {
      st.pan = true;
      clearTimeout(st.timer);
      endPress();
      canvas.classList.add('mn-grabbing');
      board.panBy(p.x - st.x0, p.y - st.y0);
      return;
    }
    if (st.pan) { board.panBy(dx, dy); return; }
    const cell = cellAt(p);
    if (cell !== st.cell && st.pen) clearTimeout(st.timer);
    st.cell = cell;
    if (!st.done) setPreview(cell, st.chord);
    board.setHover(cell);
  }

  function mouseUp(e) {
    if (!st || st.kind !== 'mouse') return;
    const p = pos(e), cell = cellAt(p);
    if (e.buttons) { buttonUp(e, cell); return; } // browsers that send pointerup per button
    const s = st;
    st = null;
    clearTimeout(s.timer);
    canvas.classList.remove('mn-grabbing');
    endPress();
    if (s.pan || s.done || cell < 0 || !ctl.playable()) return;
    if (s.chord) ctl.chord(cell);
    else if (s.btn === 0) ctl.primary(cell);
    else if (s.btn === 2 && cell === s.cell) ctl.secondary(cell); // right click on an open number: chord
  }

  // --- touch ------------------------------------------------------------------------------------------------------
  // Touch path: first finger starts a tap/long-press/pan candidate; a second finger cancels it and starts a pinch
  // (distance + midpoint snapshot). Cells are never acted on during a pinch.
  function touchDown(e) {
    const p = pos(e);
    touches.set(e.pointerId, p);
    board.setCursor(cursor, false);
    if (touches.size === 1) {
      const cell = cellAt(p);
      st = { kind: 'touch', x0: p.x, y0: p.y, cell, pan: false, done: false, timer: 0 };
      if (ctl.playable() && cell >= 0) {
        setPreview(cell, false);
        ctl.pressing(true);
        startLongPress(st);
      }
    } else if (touches.size === 2) {
      if (st && st.timer) clearTimeout(st.timer);
      endPress();
      const [a, b] = [...touches.values()];
      st = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  // Pinch: pan by the midpoint delta, zoom by the distance ratio around the midpoint - both relative to the previous
  // frame, so the content stays under the fingers.
  function touchMove(e) {
    if (!touches.has(e.pointerId)) return;
    const p = pos(e);
    const prev = touches.get(e.pointerId);
    touches.set(e.pointerId, p);
    if (!st) return;
    if (st.kind === 'pinch' && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      board.panBy(mx - st.mx, my - st.my);
      if (st.d > 0 && d > 0) board.zoomAt(d / st.d, mx, my);
      st.d = d; st.mx = mx; st.my = my;
      return;
    }
    if (st.kind === 'touch') {
      if (!st.pan && Math.hypot(p.x - st.x0, p.y - st.y0) > TOUCH_SLOP) {
        st.pan = true;
        clearTimeout(st.timer);
        endPress();
        board.panBy(p.x - st.x0, p.y - st.y0);
        return;
      }
      if (st.pan) board.panBy(p.x - prev.x, p.y - prev.y);
    }
  }

  function touchUp(e) {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (!st) return;
    if (st.kind === 'pinch') {
      // the remaining finger may keep panning, but never taps
      if (touches.size === 1) { const [p] = [...touches.values()]; st = { kind: 'touch', x0: p.x, y0: p.y, cell: -1, pan: true, done: true, timer: 0 }; }
      else st = null;
      return;
    }
    const s = st;
    st = null;
    clearTimeout(s.timer);
    endPress();
    if (e.type === 'pointercancel' || s.pan || s.done || s.cell < 0 || !ctl.playable()) return;
    ctl.primary(s.cell);
  }

  // Pointer capture for mouse/pen: moves and the release keep arriving even if the pointer leaves the canvas mid-drag.
  // Not for touch: touch pointers are implicitly captured, and multi-touch is tracked by id anyway.
  // focus({preventScroll}) gives the keyboard cursor a home without jumping the page.
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { e.preventDefault(); touchDown(e); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    mouseDown(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') touchMove(e); else mouseMove(e); });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') touchUp(e); else mouseUp(e); });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') touchUp(e);
    else { st = null; endPress(); canvas.classList.remove('mn-grabbing'); }
  });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !st) board.setHover(-1); });
  // The right button and the long press belong to the game: no browser menu (Android and Windows pen send
  // contextmenu after a long press), no callout, no text selection or magnifier (iOS), no double-tap zoom.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('selectstart', (e) => e.preventDefault());
  canvas.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  // Middle-click autoscroll would steal the chord.
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('auxclick', (e) => e.preventDefault());

  // Wheel heuristics: deltaMode 1 (lines) / 2 (pages) are normalised to pixels (33 px per line ~ Firefox line height).
  // Ctrl/Meta + wheel (and trackpad pinch, which browsers report as ctrl+wheel) zooms smoothly by exp(-dy * k).
  // passive:false is required for preventDefault, otherwise the page would scroll as well.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) { board.zoomAt(Math.exp(-dy * 0.0035), p.x, p.y); return; }
    // A mouse wheel turns in big whole steps: zoom. Touchpads scroll in small steps: pan.
    const wheel = e.deltaMode === 1 || (!dx && Math.abs(dy) >= 50 && Number.isInteger(e.deltaY));
    if (wheel && !e.shiftKey) board.zoomAt(dy < 0 ? 1.18 : 1 / 1.18, p.x, p.y);
    else if (e.shiftKey && !dx) board.panBy(-dy, 0);
    else board.panBy(-dx, -dy);
  }, { passive: false });

  // --- keyboard ---------------------------------------------------------------------------------------------------
  function move(next) {
    if (next < 0) return;
    cursor = next;
    board.setCursor(cursor, true);
    ctl.announce(cursor);
  }
  // Keyboard model (a11y): the canvas is one focusable widget with a virtual cursor; announce() feeds an aria-live
  // region so screen-reader users hear the cell state. Modifier combos are left to the browser (Ctrl+R, Alt+Tab...).
  canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 5 : 1;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dirs[e.key]) {
      e.preventDefault();
      if (cursor < 0) { move(board.step(-1, 0, 0)); return; }
      let c = cursor;
      const [dx, dy] = dirs[e.key];
      // one step at a time so a torus wraps and the edge stops a flat board
      for (let k = 0; k < Math.abs(dx) + Math.abs(dy); k++) c = board.step(c, Math.sign(dx), Math.sign(dy));
      move(c);
      return;
    }
    if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      move(board.edge(cursor, { Home: 'home', End: 'end', PageUp: 'top', PageDown: 'bottom' }[e.key]));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (cursor < 0) { move(board.step(-1, 0, 0)); return; }
      if (ctl.playable()) { board.setCursor(cursor, true); ctl.primary(cursor); ctl.announce(cursor); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'f' && cursor >= 0) {
      e.preventDefault();
      if (ctl.playable()) { ctl.secondary(cursor); ctl.announce(cursor); }
      return;
    }
    if (k === 'c' && cursor >= 0) { e.preventDefault(); if (ctl.playable()) { ctl.chord(cursor); ctl.announce(cursor); } return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      if (cursor < 0) move(board.step(-1, 0, 0));
      if (cursor < 0) return;
      board.setCursor(cursor, true);
      const r = canvas.getBoundingClientRect(), c = board.cellCenter(cursor);
      ctl.menu(cursor, r.left + c.x + c.size / 2, r.top + c.y + c.size / 2);
      return;
    }
    if (e.key === 'Escape' && cursor >= 0) { board.setCursor(cursor, false); return; }
    if (ctl.key(e)) e.preventDefault();
  });
  // The cursor ring is drawn only for keyboard focus (:focus-visible), not after a mouse click.
  canvas.addEventListener('focus', () => { if (cursor >= 0) board.setCursor(cursor, canvas.matches(':focus-visible')); });
  canvas.addEventListener('blur', () => board.setCursor(cursor, false));

  return {
    cursor: () => cursor,
    reset() { cursor = -1; st = null; touches.clear(); board.setCursor(-1, false); },
  };
}

// The cells a press shows: the cell itself, or the hidden neighbours of an open number (chord).
// Cell states used here: 0 hidden, 3 question mark (both can be pressed); flagged cells (other values) are never
// pressed, so a chord preview shows exactly the cells a chord would open.
export function previewCells(game, i, chord) {
  if (!game || i < 0 || game.over) return [];
  const s = game.st[i];
  if (s === OPEN) {
    if (!chord) return [];
    const nb = new Int32Array(game.topo.maxN), k = game.topo.neighbors(i, nb);
    const out = [];
    for (let j = 0; j < k; j++) if (game.st[nb[j]] === 0 || game.st[nb[j]] === 3) out.push(nb[j]);
    return out;
  }
  return s === 0 || s === 3 ? [i] : [];
}
