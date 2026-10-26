// studio/state.js - editor state (S), the canvas / stage elements, size caps and product-scoped storage keys.
//
// Design rules:
// - One plain mutable object, no store library: every mutation of S.doc goes through history.js commit(), the single
//   place that snapshots, re-renders and schedules autosave. The other fields are view state any module may set.
// - Attachment bytes live outside the document (S.attData and the blob URL maps) so S.doc stays small: history
//   snapshots and JSON of the document scale with text, not with embedded media.
// - DOM handles are resolved at module evaluation. Module scripts are deferred, so #ed-canvas / #ed-scroll from
//   index.html already exist; a missing node yields null and fails loudly at first use.
import { UI_STATE } from '../ui/i18n.js';
import { P } from '../doc/product.js';
import { layers } from '../ui/overlays.js';
// Soft threshold (warnings / heavier handling), not a refusal; the hard caps follow.
const BIG_FILE = 8 * 1024 * 1024;
// Hard caps checked before anything is read into memory (a multi-GB drop would take the tab down).
const MAX_ATT_FILE = 100 * 1024 * 1024;
const MAX_PROJECT_FILE = 300 * 1024 * 1024;

const S = {
  doc: null,                     // current Doc (attachments WITHOUT `data`)
  lang: 'en',                    // current content (editing) language
  // Accessor, not a copy: ui/i18n.js owns the UI language; a duplicated field would drift after setUILang.
  get uiLang() { return UI_STATE.lang; },          // editor UI language (ui/i18n.js)
  set uiLang(v) { UI_STATE.lang = v; },
  sel: { bid: null, item: null },
  attData: new Map(),            // attId → base64
  attURLs: new Map(),            // attId → blob URL (previews; inert type for active formats)
  attFileURLs: new Map(),        // attId → blob URL with the real type (open / print)
  hist: { undo: [], redo: [], key: null, time: 0 },
  idb: false,                    // IndexedDB available
  saveState: 'saved',            // 'saved' | 'saving' | 'unsaved' | 'memory' | 'error' | 'readonly'
  readOnly: null,                // autosave disabled: null | 'locked' | 'stale' | 'lost' | 'deleted' (other tabs)
  baseModified: undefined,       // `modified` of the stored record this tab loaded / last saved (conflict check)
  gen: 0,                        // edit generation (autosave bookkeeping)
  fileHandle: null,              // File System Access handle of the project file
  zoom: 1, zoomFit: false, guides: true,
  device: '',                    // device-width stage: current device key (studio/stage.js)
  darkPreview: false,            // canvas shows the dark scheme (stage bar toggle)
  leftTab: 'blocks', rightTab: 'block', docTab: 'theme',
  noLeft: false, noRight: false,
  narrow: false,                 // small window: side panels are overlay drawers (index.html, max-width 1100px)
  drag: null,                    // {kind:'new', type} | {kind:'move', bid}
  layers,                        // open dialogs / menus (top = last) {el, onEsc}: ui/overlays.js
  clip: null,                    // copied block (JSON)
  pages: 1,                      // paper stage: page count estimate
  openSecs: {},                  // inspector <details> open state
  palQuery: '',
  exportOpts: null,
  ready: false,
};

const canvas = document.getElementById('ed-canvas');
const scroller = document.getElementById('ed-scroll');
// The editor canvas stylesheet (created on first use: the id carries the product prefix). Lazy because P.prefix is
// known only after the application registered its product, i.e. after this module was evaluated. An existing node
// with that id is reused rather than stacking a second <style>.
let styleNode = null;
function styleEl() {
  if (!styleNode) {
    const id = P.prefix + '-style';
    styleNode = document.getElementById(id);
    if (!styleNode) {
      styleNode = document.createElement('style');
      styleNode.id = id;
      document.head.append(styleNode);
    }
  }
  return styleNode;
}

// localStorage key of an editor preference ('<prefix>-ed-<name>'). Prefixed per product: products served from one
// origin share localStorage, unprefixed keys would leak zoom, panels and the block clipboard between editors.
const edKey = (name) => P.prefix + '-ed-' + name;

export {
  BIG_FILE,
  MAX_ATT_FILE,
  MAX_PROJECT_FILE,
  S,
  canvas,
  edKey,
  scroller,
  styleEl
};
