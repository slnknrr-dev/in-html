// readme-editor/doc.js - the document: Markdown text, its name and file handle, undo / redo snapshots, autosave in
// the browser, and the rendering of the text with markdown/gfm.js (math through math/, diagrams through diagram/,
// code through highlight/, each cached by its source). Everything else edits the document through setText /
// replaceRange and listens with onChange.
//
// Invariants:
// - S.text is the only document state. Everything else in S (blocks, headings, refs, issues) is derived by
//   render() and may be thrown away at any time.
// - Line endings are normalised to \n on load: block offsets (start/end) and every regex in the editor assume \n.
// - Undo snapshots are whole texts, not diffs. A README is small (tens of KB), 400 snapshots stay within a few MB,
//   and whole-text snapshots cannot be corrupted by a buggy inverse operation.
// - Listeners get a reason ({ kind: 'typed' | 'set' | 'history' | 'load' | 'saved', a, b }) so the textarea can
//   avoid rewriting itself when it was the source of the change.

import { renderGFM } from '../markdown/gfm.js';
import { texToMathML } from '../math/tex.js';
import { renderDiagram } from '../diagram/all.js';
import { highlight, langOf } from '../highlight/highlight.js';
import { lsGet, lsSet, debounce } from '../ui/dom.js';

export const S = {
  text: '', name: 'README.md', handle: null, dirty: false,
  blocks: [], headings: [], footnotes: '', refs: new Map(),
  sel: -1,            // selected block index
  editing: null,      // inline / table editing session (edit.js)
  issues: { math: [], diagram: [] },
};

// Observer set rather than a single callback: main.js, the outline and the status bar all listen independently.
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (why) => { for (const fn of listeners) fn(why); };

// --- history ---------------------------------------------------------------------------
const H = { stack: [], at: -1 };
let selection = () => [0, 0];
export const setSelectionSource = (fn) => { selection = fn; };
// Snapshot = { text, caret a, caret b }. Skipped when the text equals the current snapshot (no empty undo steps).
// Truncating the stack at H.at discards the redo branch, the standard linear-undo rule. The selection source is
// injected by main.js so this module never touches the textarea.
export function snapshot() {
  if (H.stack[H.at]?.text === S.text) return;
  H.stack.length = H.at + 1;
  const [a, b] = selection();
  H.stack.push({ text: S.text, a, b });
  if (H.stack.length > 400) H.stack.shift();
  H.at = H.stack.length - 1;
}
// Typing groups into one undo step per 600 ms pause; canUndo is also true when unsnapshotted typing is pending.
const typing = debounce(snapshot, 600);
export const canUndo = () => H.at > 0 || S.text !== H.stack[H.at]?.text;
export const canRedo = () => H.at < H.stack.length - 1;
// undo(): flush pending typing into a snapshot first, otherwise the last burst of typing would be skipped.
export function undo() { typing.cancel(); snapshot(); if (H.at > 0) { H.at--; restore(); } }
export function redo() { if (H.at < H.stack.length - 1) { H.at++; restore(); } }
function restore() { const h = H.stack[H.at]; S.text = h.text; touch(); emit({ kind: 'history', a: h.a, b: h.b }); }

// --- edits ---------------------------------------------------------------------------------
// Autosave debounced (400 ms) to localStorage 're-doc'; dirty = differs from the file on disk, not from autosave.
const save = debounce(() => lsSet('re-doc', { text: S.text, name: S.name }), 400);
function touch() { S.dirty = true; save(); }

// setText: snapshot before and after, so the programmatic change is exactly one undo step, separate from typing.
// Programmatic change: one undo step; sel = [a, b] caret / selection after it.
export function setText(text, sel) {
  typing.cancel();
  snapshot();
  S.text = text;
  touch();
  snapshot();
  emit({ kind: 'set', a: sel ? sel[0] : null, b: sel ? sel[1] ?? sel[0] : null });
}
export function replaceRange(a, b, text, selectInserted = false) {
  setText(S.text.slice(0, a) + text + S.text.slice(b), selectInserted ? [a, a + text.length] : [a + text.length]);
}
// Typing in the source pane (snapshots after a pause).
export function typed(text) { S.text = text; typing(); touch(); emit({ kind: 'typed' }); }

// load() resets history: undo must not walk back into the previous document. It writes the autosave immediately
// (not debounced) so a reload right after opening a file restores that file.
export function load(text, name = 'README.md', handle = null) {
  S.text = String(text || '').replace(/\r\n?/g, '\n');
  S.name = name; S.handle = handle; S.sel = -1; S.dirty = false; S.editing = null;
  H.stack = []; H.at = -1;
  snapshot();
  lsSet('re-doc', { text: S.text, name: S.name });
  emit({ kind: 'load' });
}
export const saved = () => lsGet('re-doc', null);
export function markSaved(name, handle) { if (name) S.name = name; if (handle !== undefined) S.handle = handle; S.dirty = false; emit({ kind: 'saved' }); }

// --- rendering --------------------------------------------------------------------------------
// Explicit data-theme wins; without it, the OS preference decides. Same rule as the tokens in ui/base.css.
export const isDark = () => {
  const th = document.documentElement.dataset.theme;
  return th === 'dark' || (!th && matchMedia('(prefers-color-scheme: dark)').matches);
};
// Caches keyed by source (and display mode / theme): the preview repaints everything on every change, and TeX or
// Mermaid rendering is the expensive part. Crude bound: clear the whole map past 300 entries (no LRU bookkeeping;
// a cleared cache only costs one re-render per visible formula).
const mathCache = new Map(), diagramCache = new Map();
const cached = (map, key, make) => { if (!map.has(key)) { if (map.size > 300) map.clear(); map.set(key, make()); } return map.get(key); };
export const mathHTML = (tex, display) => cached(mathCache, (display ? 'D' : 'I') + tex, () => texToMathML(tex, { display }));
export const diagramSVG = (src) => cached(diagramCache, (isDark() ? 'd' : 'l') + src, () => renderDiagram(src, { theme: isDark() ? 'dark' : 'light', idPrefix: 're', today: new Date() }));

// positions: true makes gfm.js emit block ranges and data-md-pos attributes (editor preview); false gives clean
// HTML for copy/export. Errors are collected per render so the outline can list them.
// Markdown -> { html, blocks, headings, footnotes }; positions for the editor's preview.
export function renderMarkdown(text, { positions = false } = {}) {
  const issues = { math: [], diagram: [] };
  const r = renderGFM(text, {
    positions,
    showDefs: positions,
    math: (tex, display) => { const m = mathHTML(tex, display); if (m.error) issues.math.push(m.error); return m.mathml; },
    diagram: (src) => { const d = diagramSVG(src); if (d.error) issues.diagram.push(d.error); return d.svg; },
    highlight: (code, lang) => highlight(code, langOf(lang) || lang),
  });
  r.issues = issues;
  return r;
}

export function render() {
  const r = renderMarkdown(S.text, { positions: true });
  S.blocks = r.blocks; S.headings = r.headings; S.footnotes = r.footnotes; S.refs = r.refs; S.issues = r.issues;
  if (S.sel >= S.blocks.length) S.sel = -1;
}
export const clearDiagramCache = () => diagramCache.clear();
export const blockAt = (pos) => S.blocks.findIndex((b) => b.start <= pos && pos <= b.end);
