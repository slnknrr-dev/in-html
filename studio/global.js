// studio/global.js - global keyboard shortcuts and window events of the editor.
//
// Contract: bindGlobal() runs exactly once from boot.js, before the first project is loaded. Every binder it calls
// attaches to long-lived nodes (document, window, #ed-canvas) and never to re-rendered DOM, so a full renderShell()
// never duplicates or drops a listener. Delegation over per-node listeners is the rule of the whole editor.
import { S } from './state.js';
import { flushRT } from './history.js';
import { flushSave } from './db.js';
import { bindPreviewGuard } from './canvas.js';
import { bindCanvasDnD } from './dnd.js';
import { bindCanvasEvents, bindKeyboard } from './events.js';
import { bindDrawers } from './shell.js';

// ===========================================================================
// 26. Global bindings
// ===========================================================================

function bindGlobal() {
  bindKeyboard();
  bindCanvasEvents();
  bindCanvasDnD();
  bindPreviewGuard();
  bindDrawers();
  // Persist pending changes when the page is hidden/closed. Both events, not one: visibilitychange -> hidden is the
  // last event reliably delivered on mobile (tab switch, app kill), pagehide covers desktop close and bfcache entry.
  // 'unload' is not used: unreliable on mobile and it disables the back/forward cache. flushRT first: an open
  // rich-text edit must be committed into S.doc before flushSave serialises it.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushRT(); flushSave(); } });
  window.addEventListener('pagehide', () => { flushRT(); flushSave(); });
  window.addEventListener('beforeunload', (e) => {
    // Edits that cannot reach IndexedDB (no storage, read-only tab, failed save) would be lost. Only then the native
    // "leave site?" prompt: prompting on every close would train users to ignore it. preventDefault + returnValue = ''
    // together: the spec uses the former, older Chromium/Safari still require the latter. The text is never shown.
    if (S.hist.undo.length && (!S.idb || S.readOnly || S.saveState === 'error')) { e.preventDefault(); e.returnValue = ''; }
  });
  // Log only after boot (S.ready): boot failures are reported by bootFail in boot.js. No toast: a third-party
  // script error must not interrupt editing.
  window.addEventListener('error', (e) => { if (S.ready && e.message) console.warn('editor error:', e.message); });
}

export {
  bindGlobal
};
