// ui/contextmenu.js - context menus of an area: the right mouse button, a long press with a finger or a pen (the
// gesture that would otherwise select text or show the system callout), the Menu key and Shift+F10 open the same
// menu (ui/overlays.js openMenu items).
//
// contextMenu(root, items, opts) -> detach()      (detach.open(target, info?) opens the menu from code, e.g. for a
//                                                 "more" button: info.via 'keyboard' anchors it to the target)
//   items(target, info) -> menu items | null    target: the element matched by opts.selector inside root (or root);
//                                               info: { x, y, via: 'mouse' | 'touch' | 'pen' | 'keyboard', event }.
//                                               null / [] leaves the event alone (the browser's own menu shows).
//   opts.selector     only targets matching it open a menu (closest() from the event target, inside root)
//   opts.delay        long press in ms (500)
//   opts.fields       also replace the browser menu over inputs, text areas and editable text (false: they keep
//                     copy / paste)
//   opts.vibrate      a short vibration when a long press opens the menu (true; ignored where unsupported)
//   opts.className    extra class of the menu
//   opts.label        aria-label of the menu: a string or label(target, info)
//   opts.restoreFocus focus returns to the target when a menu opened by the keyboard closes (true)
// The root gets the class ed-ctx (ui/base.css: no callout, no text selection by touch inside it, fields excepted).
// After a long press the finger is still down when the menu appears: its release (and the click some browsers
// derive from it) activates nothing, neither the element under it nor the menu item that opened there.
//
// Design notes:
// - Why our own long-press timer instead of relying on the contextmenu event: iOS Safari never fires contextmenu
//   for touch; Android Chrome does, but with its own timing and alongside its selection UI. A Pointer Events timer
//   gives one behaviour everywhere; the native event is still handled (mouse, keyboard, Android) and de-duplicated.
// - Mouse is never long-press: desktop users have a right button, and a held left button means drag / select.
// - Listeners are passive where they never preventDefault (pointer*): scrolling stays on the compositor thread.
//   contextmenu and selectstart are not passive because they cancel the default.
// - Capture-phase document listeners in guardLift(): they run before any element handler, so the swallowed click
//   cannot reach app code even if the app stops propagation.
import { openMenu } from './overlays.js';

// Finger jitter allowance in CSS px: beyond it the gesture is a scroll/drag, not a press.
const MOVE_TOLERANCE = 10;
// Window in which a contextmenu event after our own touch-opened menu is treated as an echo of the same gesture.
const SUPPRESS_MS = 800;
// How long after the lift a derived click may still arrive (some engines delay it ~300ms for double-tap detection).
const LIFT_CLICK_MS = 400;

// Editable targets keep the native menu (copy / paste / spelling) unless opts.fields. Same list as the base.css
// re-enable rule for user-select. [contenteditable=""] and ="true" both mean editable; "false" must not match.
const isField = (el) => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

// Swallows the click that may follow the lift of the pointer that opened a menu by a long press. Ends with that click,
// LIFT_CLICK_MS after the lift, or when another gesture starts. pointerId null: any pointer.
function guardLift(pointerId) {
  let timer = 0;
  const mine = (e) => pointerId == null || e.pointerId === pointerId;
  const off = () => {
    clearTimeout(timer);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('click', click, true);
  };
  function up(e) { if (mine(e)) { clearTimeout(timer); timer = setTimeout(off, LIFT_CLICK_MS); } }
  function down() { off(); } // a new gesture (a tap on a menu item) works normally
  function click(e) { e.preventDefault(); e.stopImmediatePropagation(); off(); }
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('click', click, true);
  // A lift that never reports (the pointer left the window): give up after a while. Without this safety net a lost
  // pointerup would leave a document-wide click swallower installed, breaking the next click anywhere.
  timer = setTimeout(off, 15000);
}

function contextMenu(root, items, opts = {}) {
  const delay = opts.delay ?? 500;
  let press = null;
  // When a touch / pen gesture last opened a menu: the same gesture may also fire contextmenu (Android) or the timer,
  // which must not open a second menu (mouse menus may follow each other at any pace).
  let touchOpenedAt = -Infinity;

  // Delegation: one set of listeners on root serves any number of items (rows can be re-rendered freely).
  // root.contains(t) after closest(): closest() may climb ABOVE root and match an ancestor outside the area.
  const targetOf = (el) => {
    if (!(el instanceof Element) || !root.contains(el)) return null;
    if (!opts.selector) return root;
    const t = el.closest(opts.selector);
    return t && root.contains(t) ? t : null;
  };

  // Returns whether a menu opened, so callers preventDefault only then: when items() yields nothing, the browser's
  // own menu must still appear. items() errors are logged and treated as "no menu" — a buggy menu builder must not
  // also kill the native menu. Keyboard menus anchor to the target element (no pointer position exists).
  const open = (target, info) => {
    let list;
    try { list = items(target, info); } catch (e) { console.error(e); return false; }
    if (!list || !list.some(Boolean)) return false;
    if (info.via === 'touch' || info.via === 'pen') touchOpenedAt = performance.now();
    const keyboard = info.via === 'keyboard';
    // Focus goes back to the target (or the element inside it that had it) when a keyboard-opened menu closes.
    const active = document.activeElement;
    const back = keyboard && opts.restoreFocus !== false ? (active instanceof Element && target.contains(active) ? active : target) : null;
    const label = typeof opts.label === 'function' ? opts.label(target, info) : opts.label;
    openMenu(keyboard ? target : { x: info.x, y: info.y }, list, {
      className: 'ed-ctx-menu' + (opts.className ? ' ' + opts.className : ''), restoreFocus: back, label: label || null,
    });
    return true;
  };

  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };

  function onContextMenu(e) {
    // The long press already opened our menu (Android fires contextmenu for the same gesture): keep the system's away.
    // A right click with the mouse (button 2 from a mouse) is never such an echo.
    // Heuristic stack because contextmenu is a PointerEvent only in newer engines: pointerType when present,
    // sourceCapabilities.firesTouchEvents (Chromium), else "not a right button" (touch-derived contextmenu reports
    // button 0 or -1). False positives only matter inside the 800ms window, where they are harmless.
    const touchish = e.pointerType === 'touch' || e.pointerType === 'pen' || !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) || e.button !== 2;
    if (touchish && performance.now() - touchOpenedAt < SUPPRESS_MS) { e.preventDefault(); return; }
    if (!opts.fields && isField(e.target)) return;
    const target = targetOf(e.target);
    if (!target) return;
    // Menu key / Shift+F10: no pointer position (0, 0) or a PointerEvent without a pointer type.
    // Edge case: a real right-click exactly at viewport (0,0) is excluded by the button !== 2 guard.
    // via: a pending long press (press) means the native event beat our timer (Android) — report it as touch/pen.
    const keyboard = (e.pointerType === '' && e.button !== 2) || (e.clientX === 0 && e.clientY === 0 && e.button !== 2);
    const via = keyboard ? 'keyboard' : press ? press.type : (e.pointerType === 'touch' || e.pointerType === 'pen') ? e.pointerType : 'mouse';
    const id = press ? press.id : null;
    cancelPress();
    if (open(target, { x: e.clientX, y: e.clientY, via, event: e })) {
      e.preventDefault();
      if (via === 'touch' || via === 'pen') guardLift(id);
    }
  }

  // Long press: arm a timer on the primary touch/pen pointer; move beyond tolerance, lift, cancel or scroll disarms
  // it. A second finger (!isPrimary) means pinch-zoom — cancel. The timer re-checks press === p because a newer
  // gesture may have replaced it, and re-checks the echo window because Android's native contextmenu may have
  // already opened the menu for this very gesture.
  function onPointerDown(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (!e.isPrimary) { cancelPress(); return; }
    if (!opts.fields && isField(e.target)) return;
    const target = targetOf(e.target);
    if (!target) return;
    cancelPress();
    const p = { x: e.clientX, y: e.clientY, type: e.pointerType, id: e.pointerId, target, timer: 0 };
    p.timer = setTimeout(() => {
      if (press !== p) return;
      press = null;
      if (performance.now() - touchOpenedAt < SUPPRESS_MS) return;
      if (open(target, { x: p.x, y: p.y, via: p.type, event: e })) {
        guardLift(p.id);
        // Haptic confirmation (the finger hides the menu's appearance); try/catch: some browsers throw when vibrate
        // is blocked by policy or called without a prior user activation. Any selection the press started is
        // cleared so no selection handles appear over the menu.
        if (opts.vibrate !== false) { try { navigator.vibrate?.(12); } catch { /* not allowed */ } }
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      }
    }, delay);
    press = p;
  }

  function onPointerMove(e) {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  }

  function onPointerEnd(e) {
    if (press && e.pointerId === press.id) cancelPress();
  }

  // While a press is armed, block text selection from starting (the CSS user-select:none covers hover:none devices
  // only; pens on hybrid laptops report hover). Fields keep selection.
  function onSelectStart(e) { if (press && !isField(e.target)) e.preventDefault(); }

  root.classList.add('ed-ctx');
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('pointerdown', onPointerDown, { passive: true });
  root.addEventListener('pointermove', onPointerMove, { passive: true });
  root.addEventListener('pointerup', onPointerEnd, { passive: true });
  root.addEventListener('pointercancel', onPointerEnd, { passive: true });
  root.addEventListener('selectstart', onSelectStart);
  // Capture on window: scroll does not bubble, capture catches scrolling of ANY inner scroller, which also means
  // the finger is panning, not pressing.
  window.addEventListener('scroll', cancelPress, true);

  // detach() mirrors every add exactly (same listener refs, same capture flag — removeEventListener matches on both).
  function detach() {
    cancelPress();
    root.classList.remove('ed-ctx');
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('selectstart', onSelectStart);
    window.removeEventListener('scroll', cancelPress, true);
  }
  // Opens the menu of a target from code (a "more" button): anchored to the target unless a point is given.
  // Default via 'keyboard' also restores focus to the target on close — right for a button activated by Enter/Space,
  // and harmless for a mouse click on it.
  detach.open = (target, info = {}) => {
    const r = target.getBoundingClientRect();
    return open(target, { x: info.x ?? r.left, y: info.y ?? r.bottom, via: info.via || (info.x != null ? 'mouse' : 'keyboard'), event: info.event || null });
  };
  return detach;
}

export { contextMenu };
