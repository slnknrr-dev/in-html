// studio/i18n.js - the shared editor dictionaries (7 UI languages) and switching the editor's UI language (relabels
// and re-renders the whole editor). Products add their own keys with addDicts (ui/i18n.js).
//
// The i18n-<lang>.js imports are side effects: each calls addDicts() at evaluation time, so the dictionaries exist
// before any importer of this module calls t(). '../ui/strings.js' first (shared UI keys); a product's own addDicts
// runs later and therefore overrides. ES module evaluation order = import order, which is what makes this reliable.
import '../ui/strings.js';
import './i18n-en.js';
import './i18n-ru.js';
import './i18n-uk.js';
import './i18n-de.js';
import './i18n-fr.js';
import './i18n-es.js';
import './i18n-ka.js';
import { lsSet } from '../ui/dom.js';
import { UI_STATE, applyStaticI18n } from '../ui/i18n.js';
import { renderCanvas } from './canvas.js';
import { refreshPanels, renderShell } from './shell.js';
import { rtInit } from '../richtext/input.js';
import { tblInit } from '../richtext/table-ui.js';

// Order matters: state and <html lang> first (screen readers, hyphenation and :lang() CSS read it), then static
// [data-i18n] text, the shell (rebuilds panels from t()), the toolbars, the canvas (edit chrome labels), panels last.
// The 'ed-uilang' event lets product modules relabel what they own without studio importing them (dependencies point
// product -> studio, never back).
export function setUILang(code) {
  UI_STATE.lang = code;
  lsSet(UI_STATE.storageKey, code);
  document.documentElement.lang = code;
  applyStaticI18n();
  renderShell();
  // Rich-text and table toolbars are built once; rebuilding them relabels in the new UI language.
  try { rtInit(); tblInit(); } catch (e) { console.error(e); }
  renderCanvas();
  refreshPanels(true);
  document.dispatchEvent(new CustomEvent('ed-uilang', { detail: code }));
}
