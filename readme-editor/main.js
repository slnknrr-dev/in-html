// readme-editor/main.js - README Editor: the page. The Markdown source and the rendered README side by side (split,
// visual or source view with a resizer), GitHub / Codeberg flavour, editing in the preview (text, tables, images,
// badges, formulas, diagrams), the format toolbar and the insert menu, files (open, save, save as, download, a
// project folder with relative images, drag & drop and paste), undo / redo, list continuation, autosave in the
// browser, the outline with hints, a status bar, copy HTML and an HTML page export.
//
// Architecture (module roles; this file is the composition root and owns nothing but wiring):
// - doc.js      the single source of truth: S.text (Markdown) plus undo history. Every edit, from any pane, ends
//               as setText / replaceRange / typed on S.text; onChange then repaints. The preview is never edited as
//               DOM-of-record: in-place edits are serialised back to Markdown first (edit.js). Why: two sources of
//               truth (DOM + text) drift on every round trip; one text and a pure render cannot.
// - preview.js  renders S.text into blocks with source positions (start/end offsets), selection, block toolbar.
// - edit.js     contenteditable sessions on one block; commitEdit() writes the block back into S.text.
// - files.js    File System Access API with download/upload fallbacks; outline.js the TOC and lint hints.
// Hooks (P.hooks.select / insert / status) are set here so preview.js does not import main.js (no import cycle).
// Typing in the textarea is debounced (paintSoon, 160 ms); programmatic changes repaint immediately, because they
// are discrete user actions whose result should be visible at once.

import './strings.js';
import { startApp, copyText, download as downloadData, seg } from '../ui/app.js';
import { h, $, debounce, lsGet, lsSet, clamp } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl, addIcons } from '../ui/icons.js';
import { toast, openMenu, confirmDialog, promptDialog } from '../ui/overlays.js';
import { MATH_CSS } from '../math/tex.js';
import { HIGHLIGHT_CSS, HIGHLIGHT_CSS_DARK } from '../highlight/highlight.js';
import { S, onChange, setText, replaceRange, typed, undo, redo, load, saved, setSelectionSource, renderMarkdown, clearDiagramCache, blockAt } from './doc.js';
import { P, mountPreview, paint, selectBlock, insertBlock, setRemote, setBoxName, blockEl } from './preview.js';
import { mountEditing, startEdit, commitEdit, canEditInPlace, editCommand } from './edit.js';
import { TEMPLATES, openInsertMenu, sample } from './insert.js';
import { linkDialog, tableDialog, imageDialog, mathDialog, helpDialog } from './dialogs.js';
import { badgeDialog } from './badge-dialog.js';
import { F, openFile, openDropped, openFolder, openFromFolder, save, download, isMarkdownFile } from './files.js';
import { mountOutline, updateOutline } from './outline.js';

const LOGO = 'M4 4h16v16H4zM7.5 15V9l2.5 3 2.5-3v6M16 9v6M14 13l2 2 2-2';
addIcons({ readme: LOGO, bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', sigma: 'M18 4H6l6 8-6 8h12', diagram: 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v4h10v2', split: 'M3 4h18v16H3zM12 4v16' });
// Deployment mode injected by the build (IN_HTML_ARTIFACT); 'dev' under the dev server. 'serverless' builds default
// to loading remote images (S.remote), offline builds do not: an offline promise must not fetch from the network.
const mode = (globalThis.IN_HTML_ARTIFACT && globalThis.IN_HTML_ARTIFACT.mode) || 'dev';
S.remote = lsGet('re-remote', mode === 'serverless');

// Highlight colours and math styles come from the libraries as CSS text.
// The libraries ship dark highlight CSS unscoped; scoped() prefixes every selector so the dark palette applies
// (a) when the user forced dark via data-theme, (b) under OS dark unless the user forced light. Same two-branch
// pattern as the tokens in ui/base.css. The regex rewrites "sel1, sel2 {" after each "}" or at the start; it
// assumes flat CSS (no nested @media in the input), which holds for these generated strings.
const scoped = (css, pre) => css.replace(/(^|\})\s*([^{}]+)\{/g, (m, a, sel) => `${a}${sel.split(',').map((s) => pre + s.trim()).join(',')}{`);
document.head.append(h('style', {}, MATH_CSS + '\n' + HIGHLIGHT_CSS + '\n' + scoped(HIGHLIGHT_CSS_DARK, ':root[data-theme="dark"] ') +
  '\n@media (prefers-color-scheme: dark){' + scoped(HIGHLIGHT_CSS_DARK, ':root:not([data-theme="light"]) ') + '}'));

const status = h('div', { class: 're-status' }, h('span', { class: 're-st-l' }), h('span', { class: 'ed-spacer' }), h('button', { type: 'button', class: 're-st-hints', onclick: () => toggleSide(true) }), h('span', { class: 're-st-r' }));
startApp({ key: 're', name: 'app.name', logo: LOGO, offline: mode === 'offline' ? true : 'serverless', footer: () => status, onLang: () => { buildUI(); paint(); } });
// Body hook for app.css (`body.re`, `.re .ap-*`): added after startApp so the shell markup exists.
document.body.classList.add('re');

const main = $('#main');
const ta = h('textarea', { class: 're-ta', spellcheck: 'false', 'aria-label': t('src.label') });
const wrap = h('div', { class: 're-wrap' });
const ctx = h('div', { class: 're-ctx', hidden: true, role: 'toolbar' });
const side = h('aside', { class: 're-side', hidden: !lsGet('re-side', false) });
const srcPane = h('section', { class: 're-srcpane' }, ta);
// role=separator + aria-orientation + tabindex: the ARIA pattern for a focusable splitter; arrow keys resize below.
const resizer = h('div', { class: 're-resizer', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0' });
const pvPane = h('section', { class: 're-pvpane' }, ctx, wrap);
const work = h('div', { class: 're-work' }, srcPane, resizer, pvPane, side);
const tools = h('div', { class: 're-tools' });
main.append(tools, work);
mountPreview(wrap);
mountEditing(ctx);
mountOutline(side);
setSelectionSource(() => [ta.selectionStart, ta.selectionEnd]);
// The last-used surface decides where toolbar actions apply: textarea focus = source caret; mousedown in the
// preview (capture phase, so it runs before any handler can stop propagation) = selected block.
let lastSource = false;
ta.addEventListener('focus', () => { lastSource = true; });
wrap.addEventListener('mousedown', () => { lastSource = false; }, true);

// ib(): icon button. A lowercase ASCII word longer than 2 chars is an icon name; anything else ('B', 'H1', '1.',
// '∑', a node) renders as a text glyph. Heuristic keeps the toolbar declaration one line per button.
// --- toolbar -----------------------------------------------------------------------------------------
const ib = (key, icon, fn, extra = {}) => h('button', { type: 'button', class: 'ed-iconbtn', title: t(key), 'aria-label': t(key), onclick: fn, ...extra }, typeof icon === 'string' && icon.length > 2 && !/[^a-z]/.test(icon) ? iconEl(icon) : h('span', { class: 're-glyph' }, icon));
const tb = (key, icon, fn) => h('button', { type: 'button', class: 'ed-btn ed-sm', title: t(key + '.tip'), onclick: fn }, iconEl(icon), h('span', { class: 're-btxt' }, t(key)));
// buildUI() is idempotent and re-run on language switch and after opening a folder (the folder select depends on
// F.mdFiles). replaceChildren() swaps the rows atomically; the textarea and preview are untouched, so text,
// caret and scroll survive a language switch.
let viewSeg, flavorSeg, dirSel;
function buildUI() {
  ta.setAttribute('aria-label', t('src.label'));
  ta.placeholder = t('src.placeholder');
  dirSel = h('select', { class: 'ed-input ed-select re-dirsel', hidden: !F.mdFiles.length && !F.dirName, title: t('file.dirFiles'), onchange: async () => {
    if (dirSel.value === '+') { const n = await promptDialog(t('file.newInFolder'), t('file.name'), 'README.md'); if (n) await openFromFolder(n); else dirSel.value = ''; return; }
    if (dirSel.value) await openFromFolder(dirSel.value);
  } }, h('option', { value: '' }, '📁 ' + F.dirName + '/'), F.mdFiles.map((p) => h('option', { value: p }, p)), F.dir ? h('option', { value: '+' }, t('file.newFile')) : null);
  viewSeg = seg([{ v: 'visual', l: 'view.visual', icon: 'eye' }, { v: 'split', l: 'view.split', icon: 'split' }, { v: 'source', l: 'view.source', icon: 'terminal' }].map((o) => ({ ...o, iconOnly: true })), view, setView, 'view.label');
  flavorSeg = seg([{ v: 'github', l: '=GitHub' }, { v: 'codeberg', l: '=Codeberg' }], flavor, setFlavor, 'flavor.label');
  const row1 = h('div', { class: 're-row1' },
    tb('file.new', 'file', newDoc), tb('file.open', 'folder', () => guard(openFile)), tb('file.folder', 'layers', pickFolder), dirSel,
    tb('file.save', 'save', () => doSave()), ib('file.more', 'more', (e) => moreMenu(e.currentTarget)),
    h('span', { class: 're-fname', title: t('file.name') }), h('span', { class: 'ed-spacer' }), viewSeg, flavorSeg,
    // mousedown preventDefault while editing in place: a click on a toolbar button would otherwise move focus out of
    // the contenteditable and collapse its selection before the command runs.
    ib('side.toggle', 'list', () => toggleSide()), ib('help.title', 'help', helpDialog));
  const fmtBtn = (k, g) => ib('fmt.' + k, g, () => fmt(k), { onmousedown: (e) => { if (S.editing) e.preventDefault(); } });
  const row2 = h('div', { class: 're-row2', role: 'toolbar', 'aria-label': t('fmt.label') },
    fmtBtn('bold', h('b', {}, 'B')), fmtBtn('italic', h('i', {}, 'I')), fmtBtn('strike', h('s', {}, 'S')), fmtBtn('code', '</>'), fmtBtn('link', 'link'), h('span', { class: 're-sep' }),
    fmtBtn('h1', 'H1'), fmtBtn('h2', 'H2'), fmtBtn('h3', 'H3'), fmtBtn('ul', 'list'), fmtBtn('ol', '1.'), fmtBtn('task', '☑'), fmtBtn('quote', 'quote'), h('span', { class: 're-sep' }),
    tb('ins.table', 'table', () => runInsert('@table')), tb('ins.image', 'image', () => runInsert('@image')), tb('ins.badge', 'shield', () => runInsert('@badge')),
    ib('ins.mathInline', '∑', () => runInsert('@mathInline')), ib('ins.mathBlock', '$$', () => runInsert('mathBlock')), ib('ins.mm-flowchart', 'diagram', (e) => openInsertMenu(e.currentTarget, (id) => runInsert(id))),
    h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary re-insbtn', onclick: (e) => openInsertMenu(e.currentTarget, (id) => runInsert(id)) }, iconEl('plus'), t('ins.menu')),
    h('span', { class: 're-sep' }), ib('edit.undo', 'undo', () => undo()), ib('edit.redo', 'redo', () => redo()));
  tools.replaceChildren(row1, row2);
  wrap.querySelector('.re-notice button').textContent = t('pv.showRemote');
  P.el.setAttribute('aria-label', t('pv.label'));
  side.replaceChildren();
  mountOutline(side);
  names();
}

function moreMenu(anchor) {
  openMenu(anchor, [
    { label: t('file.saveAs'), icon: 'save', kbd: 'Ctrl+Shift+S', action: () => doSave(true) },
    { label: t('file.download'), icon: 'download', action: () => download() },
    { sep: true },
    { label: t('file.copyHtml'), icon: 'copy', action: () => copyText(renderMarkdown(S.text).html, t('file.htmlCopied')) },
    { label: t('file.exportHtml'), icon: 'export', action: exportPage },
    { sep: true },
    { label: t('pv.remoteToggle'), checked: S.remote, action: () => setRemote(!S.remote) },
  ], { label: t('file.more') });
}

// --- views ---------------------------------------------------------------------------------------------
// Default view: visual on phones (no room for two panes), split elsewhere. The media query is read once at startup;
// a later resize keeps the user's choice.
let view = lsGet('re-view', matchMedia('(max-width: 760px)').matches ? 'visual' : 'split');
let flavor = lsGet('re-flavor', 'github');
function setView(v) { view = v; work.dataset.view = v; viewSeg?.set(v); lsSet('re-view', v); }
// setFlavor toggles two classes: md-codeberg on the rendered body (gfm.css differences) and re-codeberg on the
// frame (app.css). viewSeg?.set: the segments do not exist yet on the first call during startup.
function setFlavor(f) { flavor = f; P.el.classList.toggle('md-codeberg', f === 'codeberg'); wrap.classList.toggle('re-codeberg', f === 'codeberg'); flavorSeg?.set(f); lsSet('re-flavor', f); }
function toggleSide(on) { side.hidden = on == null ? !side.hidden : !on; lsSet('re-side', !side.hidden); updateOutline(); }
const srcW = lsGet('re-srcw', 0);
if (srcW) srcPane.style.flexBasis = srcW + 'px';
// Pointer events + setPointerCapture: one code path for mouse, pen and touch; capture keeps move events coming
// even when the pointer leaves the 5px handle. The box is measured once at drag start (layout is stable during the
// drag). Limits: source at least 160px, preview at least 280px.
// KNOWN DEFECT: only pointerup removes the move listener; a pointercancel (e.g. the OS taking the touch) leaves
// mv attached until the next pointerup. Fix: also listen for 'pointercancel' (or 'lostpointercapture') with `up`.
resizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  const box = work.getBoundingClientRect();
  const mv = (ev) => { const w = clamp(ev.clientX - box.left, 160, box.width - 280); srcPane.style.flexBasis = w + 'px'; };
  const up = () => { resizer.removeEventListener('pointermove', mv); lsSet('re-srcw', parseInt(srcPane.style.flexBasis, 10) || 0); };
  resizer.addEventListener('pointermove', mv);
  resizer.addEventListener('pointerup', up, { once: true });
});
// Keyboard resize in 40px steps for the focusable separator.
resizer.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const w = srcPane.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -40 : 40);
  srcPane.style.flexBasis = clamp(w, 160, work.clientWidth - 280) + 'px';
});

// --- source pane ---------------------------------------------------------------------------------------
const paintSoon = debounce(() => paint(), 160);
ta.addEventListener('input', () => typed(ta.value));
// Tab inserts two spaces (Markdown nested list indent) instead of moving focus; with a selection or Shift it
// indents / outdents whole lines. Ctrl/Alt+Tab are left alone so OS and browser shortcuts keep working.
// KNOWN DEFECT (accessibility): there is no escape hatch, so keyboard users cannot Tab out of the textarea.
// Fix: let Escape then Tab, or Ctrl+M (the WAI-ARIA convention used by code editors), toggle tab trapping.
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (s === en && !e.shiftKey) ta.setRangeText('  ', s, en, 'end');
    else {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const block = v.slice(ls, en);
      const out = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
      ta.setRangeText(out, ls, en, 'select');
    }
    typed(ta.value);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Lists continue (an empty item ends the list); quotes continue.
    const s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(ls, s);
    // Groups: 1 quote/indent prefix, 2 bullet, 3-4 ordinal and its delimiter, 5 spacing, 6 task box, 7 item text.
    // The second regex matches a quote line without a list marker (empty groups keep the same indices).
    const m = /^(\s*(?:>\s?)*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line) || /^(\s*(?:>\s?)+)()()()()()(.*)$/.exec(line);
    if (m && (m[2] || m[3] || m[1].includes('>'))) {
      e.preventDefault();
      // Enter on an empty item removes the marker (ends the list), like every word processor.
      if (!m[7].trim()) ta.setRangeText('', ls, s, 'end');
      else { const mk = m[3] ? (+m[3] + 1) + m[4] : m[2] || ''; ta.setRangeText('\n' + m[1] + mk + (mk ? m[5] : '') + (m[6] ? '[ ] ' : ''), s, ta.selectionEnd, 'end'); }
      typed(ta.value);
    }
  }
});
// Caret to preview sync: select the block under the caret, but never while an in-place edit is active (it would
// steal the editing session from under the user).
const syncFromCaret = () => {
  const i = blockAt(ta.selectionStart);
  if (i >= 0 && i !== S.sel && !S.editing) { selectBlock(i, { scrollSource: false }); blockEl(i)?.scrollIntoView({ block: 'nearest' }); }
  updateStatus();
};
ta.addEventListener('click', syncFromCaret);
ta.addEventListener('keyup', (e) => { if (/Arrow|Page|Home|End/.test(e.key)) syncFromCaret(); });
// Preview to source sync: line-based scroll estimate (lines * line-height) puts the selection about a third down.
// Approximate because soft-wrapped lines are taller, but it needs no hidden mirror element.
P.hooks.select = (a, b) => {
  ta.setSelectionRange(a, b);
  const line = ta.value.slice(0, a).split('\n').length - 1;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
};

// typed: the textarea already shows the text, only repaint (debounced). Any other change came from elsewhere:
// write it into the textarea, restore the caret the change requested, cancel a pending debounced paint and paint now.
onChange((ev) => {
  if (ev.kind === 'typed') { paintSoon(); names(); return; }
  if (ta.value !== S.text) ta.value = S.text;
  if (ev.a != null) { ta.setSelectionRange(ev.a, ev.b ?? ev.a); }
  paintSoon.cancel();
  paint();
  names();
});

// --- formatting ----------------------------------------------------------------------------------------
// Removes any existing block prefix (heading hashes, quote, bullet/ordinal and task box), so converting between
// block types never stacks prefixes ("# - text").
const STRIP = /^(#{1,6}\s+|>\s?|\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?)/;
async function fmt(f) {
  if (S.editing) {
    const map = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', code: 'code', link: 'link', h1: 'h1', h2: 'h2', h3: 'h3', ul: 'ul', ol: 'ol' };
    if (map[f]) editCommand(map[f]);
    return;
  }
  // When the preview was used last, list/heading buttons convert the selected block as a whole; otherwise they act on
  // the textarea lines around the selection.
  if (!lastSource && S.sel >= 0 && /^(h[1-3]|ul|ol|task|quote)$/.test(f)) {
    // Convert the selected block.
    const b = S.blocks[S.sel];
    const lines = S.text.slice(b.start, b.end).split('\n').map((l) => l.replace(STRIP, ''));
    const out = f[0] === 'h' ? '#'.repeat(+f[1]) + ' ' + lines.join(' ') : lines.map((l, k) => (f === 'ul' ? '- ' : f === 'ol' ? `${k + 1}. ` : f === 'task' ? '- [ ] ' : '> ') + l).join('\n');
    replaceRange(b.start, b.end, out);
    return;
  }
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  // wrapSel: wrap the selection (or a placeholder) and select the inner text, so a second click or typing replaces it.
  const wrapSel = (a, z = a, ph = t('fmt.placeholder')) => { const x = sel || ph; setText(v.slice(0, s) + a + x + z + v.slice(e), [s + a.length, s + a.length + x.length]); ta.focus(); };
  const lines = (fn) => {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    const out = v.slice(ls, le).split('\n').map(fn).join('\n');
    setText(v.slice(0, ls) + out + v.slice(le), [ls, ls + out.length]);
    ta.focus();
  };
  let k = 0;
  switch (f) {
    case 'bold': return wrapSel('**');
    case 'italic': return wrapSel('*');
    case 'strike': return wrapSel('~~');
    case 'code': return sel.includes('\n') ? wrapSel('```\n', '\n```', 'code') : wrapSel('`', '`', 'code');
    // The new selection covers the whole "[text](url)" (lengths of text + url + 4 bracket characters).
    case 'link': { const r = await linkDialog(sel, ''); if (r) { setText(v.slice(0, s) + `[${r.text || r.url}](${r.url})` + v.slice(e), [s, s + (r.text || r.url).length + r.url.length + 4]); ta.focus(); } return; }
    case 'h1': case 'h2': case 'h3': return lines((l) => '#'.repeat(+f[1]) + ' ' + l.replace(STRIP, ''));
    case 'ul': return lines((l) => '- ' + l.replace(STRIP, ''));
    case 'ol': return lines((l) => `${++k}. ` + l.replace(STRIP, ''));
    case 'task': return lines((l) => '- [ ] ' + l.replace(STRIP, ''));
    case 'quote': return lines((l) => '> ' + l.replace(STRIP, ''));
  }
}

// --- insertion ----------------------------------------------------------------------------------------
// pad: inline content appended to a paragraph gets a separating space unless the text already ends in whitespace.
// Inline pieces go to the source caret (when the source was used last) or to the end of the selected text block.
function inlineTarget() {
  if (lastSource && view !== 'visual') return { pos: ta.selectionStart, inline: true };
  const b = S.blocks[S.sel];
  if (b && (b.type === 'paragraph' || b.type === 'heading')) return { pos: b.end, inline: true, pad: true };
  return { pos: b ? b.end : S.text.length, inline: false };
}
function putInline(code, block) {
  const tg = inlineTarget();
  if (block || !tg.inline) return insertBlock(code, tg.pos);
  const v = S.text;
  const text = (tg.pad && !/\s$/.test(v.slice(0, tg.pos)) ? ' ' : '') + code;
  setText(v.slice(0, tg.pos) + text + v.slice(tg.pos), [tg.pos + text.length]);
}
// '@' ids open a dialog first; plain ids are templates (insert.js). A pending in-place edit is committed first so
// the insertion position refers to the current text.
async function runInsert(id, pos) {
  if (S.editing) commitEdit();
  if (id === '@table' || id === '@tableHtml') {
    const code = await tableDialog(id === '@tableHtml' ? 'html' : 'md');
    if (!code) return;
    const i = insertBlock(code, pos);
    if (i >= 0 && canEditInPlace(i)) startEdit(i);
    return;
  }
  if (id === '@image') { const r = await imageDialog(null); if (r && r.code) (pos != null ? insertBlock(r.code, pos) : putInline(r.code, r.block)); return; }
  if (id === '@badge') { const r = await badgeDialog(null); if (r && r.code) (pos != null ? insertBlock(r.code, pos) : putInline(r.code)); return; }
  if (id === '@mathInline') { const tex = await mathDialog('x^2 + y^2 = r^2'); if (tex) (pos != null ? insertBlock('$' + tex + '$', pos) : putInline('$' + tex + '$')); return; }
  const tpl = TEMPLATES[id];
  if (tpl) insertBlock(tpl(), pos ?? (lastSource && view !== 'visual' ? ta.selectionStart : undefined));
}
P.hooks.insert = runInsert;

// --- files ---------------------------------------------------------------------------------------------
// guard(): confirm before replacing unsaved text, but only when it would be lost: text with a file handle can be
// saved again, and empty text has nothing to lose. Also the single try/catch boundary for file actions.
async function guard(fn) {
  if (S.dirty && S.text.trim() && !S.handle && !(await confirmDialog(t('file.discardTitle'), t('file.discard'), t('file.continue'), true))) return;
  try { await fn(); } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
async function newDoc() { await guard(async () => { F.base = ''; load('', 'README.md'); }); }
async function pickFolder() {
  try {
    const list = await openFolder();
    if (!list) return;
    buildUI();
    toast(t(F.dir ? 'file.folderOpen' : 'file.folderReadOnly', { name: F.dirName }), 'ok');
    const first = list.find((p) => /^readme\.md$/i.test(p)) || list[0];
    if (first && (!S.dirty || await confirmDialog(t('file.discardTitle'), t('file.openFromFolder', { name: first }), t('file.continue')))) { await openFromFolder(first); dirSel.value = first; } else paint();
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
async function doSave(as = false) {
  if (S.editing) commitEdit();
  try {
    const r = await save({ as });
    if (r === 'saved') toast(t('file.saved', { name: S.name }), 'ok');
    else if (r === 'downloaded') toast(t('file.downloaded', { name: S.name }), 'ok');
  } catch (e) { toast(t('file.saveFail', { msg: e.message }), 'error'); }
}
// Standalone HTML export: copies only the CSS rules the rendered Markdown needs (gfm, math, highlight), filtered by
// selector text. sh.cssRules throws a SecurityError for cross-origin sheets, hence the per-sheet try/continue.
// The title has '<' and '&' removed (not escaped): enough to keep it from breaking out of <title>.
function exportPage() {
  const css = [];
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (const r of rules) if (/md-body|\bmath\b|\.hl-|mtd|mtable|merror/.test(r.cssText)) css.push(r.cssText); }
  const title = S.headings[0]?.text || S.name.replace(/\.\w+$/, '');
  const page = `<!doctype html>\n<html lang="${document.documentElement.lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>${title.replace(/[<&]/g, '')}</title>\n<style>body{margin:0;padding:32px 16px}.md-body{max-width:980px;margin:0 auto}${css.join('\n')}</style>\n</head>\n<body class="md-body${flavor === 'codeberg' ? ' md-codeberg' : ''}">\n${renderMarkdown(S.text).html}\n</body>\n</html>\n`;
  downloadData(page, S.name.replace(/\.\w+$/, '') + '.html', 'text/html;charset=utf-8');
}

// Drag & drop and paste: Markdown files open, images go through the image dialog.
// dragover must preventDefault to allow a drop, but only for file drags (dragging text inside the page must keep
// its native behaviour). dragleave with relatedTarget null = the pointer left the window.
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); work.classList.add('re-drop'); } });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) work.classList.remove('re-drop'); });
document.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  work.classList.remove('re-drop');
  if (!files.length) return;
  e.preventDefault();
  const md = files.find(isMarkdownFile);
  if (md) return guard(() => openDropped(md));
  const img = files.find((f) => f.type.startsWith('image/'));
  if (!img) return toast(t('file.unknown', { name: files[0].name }), 'warn');
  const blk = e.target.closest?.('.re-blk');
  const r = await imageDialog(null, { file: img });
  if (r && r.code) (blk ? insertBlock(r.code, S.blocks[+blk.dataset.i]?.end) : putInline(r.code, r.block));
});
// Pasting an image anywhere inserts it; ignored while a dialog is open (the dialog's own inputs get the paste).
// Text pastes fall through to the focused element's default handling.
document.addEventListener('paste', async (e) => {
  if (document.querySelector('#ed-overlays .ed-backdrop')) return;
  const img = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!img) return;
  e.preventDefault();
  if (S.editing) commitEdit();
  const r = await imageDialog(null, { file: img });
  if (r && r.code) putInline(r.code, r.block);
});
// beforeunload prompt only for documents bound to a file: everything else is autosaved to localStorage anyway.
// returnValue = '' is the legacy requirement some browsers still need to show the prompt.
window.addEventListener('beforeunload', (e) => { if (S.dirty && S.handle) { e.preventDefault(); e.returnValue = ''; } });

// --- keyboard ------------------------------------------------------------------------------------------
// Global shortcuts. Order matters: save/open work even during an in-place edit; undo/redo/format below the
// S.editing check are left to the contenteditable's own handling while editing. Ignored while a dialog is open.
document.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); helpDialog(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || document.querySelector('#ed-overlays .ed-backdrop')) return;
  const k = e.key.toLowerCase();
  if (e.altKey && /^[123]$/.test(k)) { e.preventDefault(); setView(['visual', 'split', 'source'][+k - 1]); return; }
  if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
  else if (k === 'o') { e.preventDefault(); guard(openFile); }
  else if (S.editing) return;
  else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  else if (document.activeElement === ta && (k === 'b' || k === 'i')) { e.preventDefault(); fmt(k === 'b' ? 'bold' : 'italic'); }
  else if (k === 'k' && (document.activeElement === ta || !e.target.closest('input, textarea'))) { e.preventDefault(); fmt('link'); }
});

// --- status ------------------------------------------------------------------------------------------
// The tab title mirrors the dirty state with a bullet, visible in the tab strip even when the app is hidden.
function names() {
  const n = $('.re-fname', tools);
  if (n) { n.textContent = (F.dirName && S.handle ? F.dirName + '/' : '') + S.name; n.classList.toggle('re-dirty', S.dirty); }
  setBoxName(S.name);
  document.title = (S.dirty ? '• ' : '') + S.name + ' — ' + t('app.name');
}
function updateStatus() {
  const v = S.text, s = ta.selectionStart;
  const before = v.slice(0, s).split('\n');
  // Words: Unicode letters/digits (\p{L}\p{N}, u flag) so Georgian and Cyrillic count; fenced code is excluded.
  // Reading time at 220 words per minute, never shown as 0.
  const words = (v.replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}]+/gu) || []).length;
  $('.re-st-l', status).textContent = t('st.pos', { l: before.length, c: before[before.length - 1].length + 1 }) + ' · ' + t('st.words', { n: words }) + ' · ' + t('st.chars', { n: v.length }) + ' · ' + t('st.blocks', { n: S.blocks.length }) + ' · ' + t('st.read', { n: Math.max(1, Math.round(words / 220)) });
  $('.re-st-r', status).textContent = S.editing ? t(S.editing.kind === 'table' ? 'st.editTable' : 'st.editText') : S.sel >= 0 && S.blocks[S.sel] ? t('st.block', { type: t('type.' + S.blocks[S.sel].type) }) : '';
  const n = updateOutline();
  const hb = $('.re-st-hints', status);
  hb.textContent = n ? t('st.hints', { n }) : '';
  hb.hidden = !n;
}
P.hooks.status = updateStatus;

// Diagram SVGs bake in theme colours, so they are re-rendered on theme change: explicit (data-theme attribute,
// observed) or OS-level (media query change event).
// Diagrams follow the colour scheme.
const rethemed = () => { clearDiagramCache(); paint(); };
new MutationObserver(rethemed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rethemed);

// --- start ----------------------------------------------------------------------------------------------
buildUI();
setView(view);
setFlavor(flavor);
// Restore the autosaved document or show the sample README on first run.
const last = saved();
load(last && typeof last.text === 'string' ? last.text : sample(), (last && last.name) || 'README.md');
