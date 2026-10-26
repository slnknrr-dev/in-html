// readme-editor/edit.js - editing in the preview: paragraphs, headings, lists, quotes and alerts become editable in
// place (bold, italic, strike, code, links, headings, lists, keys, super / subscript) and are written back as
// Markdown (markdown/write.js, GFM mode) when the focus leaves them; images, badges, formulas, footnote references
// and emoji keep their exact source. Tables are edited cell by cell with row / column operations, alignment, moving
// and a Markdown ⇄ HTML switch. The context bar above the preview carries the commands of the active session.
//
// The round trip: rendered HTML -> contenteditable -> HTML -> Markdown (markdown/write.js) -> replaceRange on the
// block's source range. Only the edited block is rewritten; the rest of the file keeps its exact bytes.
// Risk of the approach: HTML-to-Markdown is lossy (the user's choice of '*' vs '_', reference links, odd spacing).
// Mitigations: (1) blocks whose source cannot survive the trip are not editable in place (canEditInPlace); (2)
// "atoms" (images, math, footnote refs, emoji, badges) are made non-editable and written back as their original
// source text (rawPieces, data-md-raw); (3) an unchanged block (innerHTML equal to the snapshot) is not written at
// all, so merely clicking into a block never reformats it.
// Session state lives in S.editing = { kind: 'inline' | 'table', i, el, before, start, end, ... }; doc.js paint()
// refuses to repaint while it is set (the DOM is the live editor then).

import { h, $$ } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { toast } from '../ui/overlays.js';
import { htmlToMarkdown, inlineMarkdown, tableMarkdown } from '../markdown/write.js';
import { S, replaceRange } from './doc.js';
import { P, blockEl, paint, hideBar, selectBlock } from './preview.js';
import { linkDialog } from './dialogs.js';

export const E = { ctx: null };
// Paragraphs that start with one of these inline tags are still prose (e.g. a line opening with a badge <img>);
// any other leading tag means an HTML block, which the round trip would mangle.
const INLINE_TAGS = /^\s*<(img|a|b|i|em|strong|code|kbd|sub|sup|br|span|s|del|ins|mark|small)\b/i;
// Non-editable pieces whose source is preserved verbatim. :has() selects a footnote <sup> by its link and a link that
// wraps only an image (a linked badge); requires a browser with :has() support (all evergreen browsers since 2023).
const ATOMS = 'img, picture, .md-math, sup:has(> a.md-fnref), .md-emoji, input.md-task, a[data-md-pos]:has(> img:only-child), .markdown-alert-title';

// An HTML block counts as a table only if it is exactly one <table>...</table>; mixed HTML falls back to the source
// dialog.
const isTable = (b) => b && (b.type === 'table' || (b.type === 'html' && /^\s*<table[\s>]/i.test(S.text.slice(b.start, b.end)) && /<\/table>\s*$/i.test(S.text.slice(b.start, b.end))));
export function canEditInPlace(i) {
  const b = S.blocks[i];
  if (!b) return false;
  if (isTable(b)) return true;
  if (!['paragraph', 'heading', 'list', 'quote', 'alert'].includes(b.type)) return false;
  const el = blockEl(i);
  // Rendered blocks containing code, nested tables, display math, diagrams, details or definitions are refused even
  // if their type is allowed: their content has syntax that write.js does not reproduce faithfully.
  if (el && el.querySelector('pre, table, .md-math-block, .md-diagram, details, .md-def')) return false;
  if (b.type === 'paragraph' && /^\s*</.test(S.text.slice(b.start, b.end)) && !INLINE_TAGS.test(S.text.slice(b.start, b.end))) return false;
  return true;
}

// --- context bar ------------------------------------------------------------------------------------
const btn = (key, label, fn, cls = '') => h('button', { type: 'button', class: 'ed-btn ed-sm ' + cls, title: t(key), 'aria-label': t(key), dataset: { k: key }, onclick: fn }, label);
const sep = () => h('span', { class: 're-sep' });
function showCtx(kind) {
  const c = E.ctx;
  // Context bar rebuilt per session: inline and table sessions show different commands; data-k is the e2e hook.
  c.replaceChildren();
  const cmd = (k) => () => richCmd(k);
  const fmt = [btn('fmt.bold', h('b', {}, 'B'), cmd('bold')), btn('fmt.italic', h('i', {}, 'I'), cmd('italic')), btn('fmt.strike', h('s', {}, 'S'), cmd('strikeThrough')),
    btn('fmt.code', '</>', cmd('code')), btn('fmt.link', iconEl('link'), cmd('link'))];
  if (kind === 'inline') {
    c.append(h('span', { class: 're-ctx-l' }, iconEl('edit'), t('ctx.text')), ...fmt, btn('fmt.unlink', '⌀', cmd('unlink')), sep(),
      btn('fmt.h1', 'H1', cmd('h1')), btn('fmt.h2', 'H2', cmd('h2')), btn('fmt.h3', 'H3', cmd('h3')), btn('fmt.p', '¶', cmd('p')),
      btn('fmt.ul', iconEl('list'), cmd('ul')), btn('fmt.ol', '1.', cmd('ol')), sep(),
      btn('fmt.kbd', 'kbd', cmd('kbd')), btn('fmt.sup', h('span', {}, 'x', h('sup', {}, '2')), cmd('sup')), btn('fmt.sub', h('span', {}, 'x', h('sub', {}, '2')), cmd('sub')), btn('fmt.clear', '⌫', cmd('removeFormat')));
  } else {
    const op = (k) => () => tableOp(k);
    const fmtSeg = h('span', { class: 'ed-seg' }, ['md', 'html'].map((f) => h('button', { type: 'button', class: 'ed-seg-btn' + (S.editing.fmt === f ? ' ed-on' : ''), onclick: op('fmt-' + f) }, f === 'md' ? 'Markdown' : 'HTML')));
    c.append(h('span', { class: 're-ctx-l' }, iconEl('table'), t('ctx.table')),
      btn('tbl.rowAbove', '+↑', op('rowAbove')), btn('tbl.rowBelow', '+↓', op('rowBelow')), btn('tbl.delRow', '−⇵', op('delRow')),
      btn('tbl.rowUp', '⇡', op('rowUp')), btn('tbl.rowDown', '⇣', op('rowDown')), sep(),
      btn('tbl.colLeft', '+←', op('colLeft')), btn('tbl.colRight', '+→', op('colRight')), btn('tbl.delCol', '−⇆', op('delCol')),
      btn('tbl.moveLeft', '⇠', op('moveLeft')), btn('tbl.moveRight', '⇢', op('moveRight')), sep(),
      btn('tbl.alLeft', '⫷', op('al-left')), btn('tbl.alCenter', '≡', op('al-center')), btn('tbl.alRight', '⫸', op('al-right')), btn('tbl.alNone', '–', op('al-')), sep(),
      ...fmt.slice(0, 2), fmt[3], fmt[4], fmtSeg, btn('tbl.delete', iconEl('trash'), op('delTable'), 'ed-danger'));
  }
  c.append(h('span', { class: 'ed-spacer' }), h('span', { class: 'ed-hint re-ctx-hint' }, t(kind === 'inline' ? 'ctx.hint' : 'ctx.hintTable')),
    h('button', { type: 'button', class: 'ed-btn ed-sm ed-primary', onclick: () => commitEdit() }, iconEl('check'), t('dlg.done')));
  c.hidden = false;
}
function hideCtx() { E.ctx.hidden = true; E.ctx.replaceChildren(); }

// Collapsed range at the end of a node: caret placement after inserting or converting an element.
function placeEnd(n) { const r = document.createRange(); r.selectNodeContents(n); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
async function richCmd(c) {
  if (!S.editing) return;
  // code / kbd / sup / sub are not execCommand formats, so they are applied by wrapping the selection manually
  // (extractContents then insertNode). An empty selection inserts a placeholder so the element is visible.
  if (c === 'code' || c === 'kbd' || c === 'sup' || c === 'sub') {
    const sel = getSelection();
    if (!sel.rangeCount || !S.editing.el.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    const el = document.createElement(c);
    el.append(r.extractContents());
    if (!el.textContent) el.textContent = c === 'code' ? 'code' : c === 'kbd' ? 'Ctrl' : '2';
    r.insertNode(el);
    placeEnd(el);
    return;
  }
  // The link dialog steals focus; S.editing.dialog stops the focusout handler from committing meanwhile, and the
  // saved Range restores the selection afterwards. With no selected text, an <a> with escaped text is inserted.
  // document.execCommand is deprecated but still the only API that edits contenteditable with native undo support;
  // manual DOM edits would break Ctrl+Z inside the block.
  if (c === 'link') {
    const sel = getSelection();
    const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const txt = sel.toString();
    S.editing.dialog = true;
    const res = await linkDialog(txt, '');
    if (S.editing) S.editing.dialog = false;
    if (!res || !S.editing) return;
    S.editing.el.focus();
    if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
    if (!txt) document.execCommand('insertHTML', false, `<a href="${res.url.replace(/"/g, '&quot;')}">${(res.text || res.url).replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))}</a>`);
    else document.execCommand('createLink', false, res.url);
    return;
  }
  if (/^h[1-6]$|^p$/.test(c)) {
    // Single-element block (one <p> or <hN>): swap the element directly; formatBlock would otherwise wrap or split it
    // unpredictably across browsers.
    const el = S.editing.el, inner = el.firstElementChild;
    if (S.editing.kind === 'inline' && inner && el.children.length === 1 && (inner.tagName === 'P' || /^H\d$/.test(inner.tagName))) {
      const n = document.createElement(c);
      n.innerHTML = inner.innerHTML;
      inner.replaceWith(n);
      placeEnd(n);
      return;
    }
    document.execCommand('formatBlock', false, c);
    return;
  }
  if (c === 'ul' || c === 'ol') { document.execCommand(c === 'ul' ? 'insertUnorderedList' : 'insertOrderedList'); return; }
  document.execCommand(c);
}

// --- sessions ---------------------------------------------------------------------------------------
export function startEdit(i, ev) {
  const b = S.blocks[i];
  const el = blockEl(i);
  if (!b || !el) return;
  hideBar();
  if (isTable(b)) return startTable(i, ev);
  el.classList.add('re-editing');
  // Atoms first set to contenteditable=false so the caret skips over them as units, then the block becomes editable.
  // `before` snapshots the HTML to detect "nothing changed" on commit.
  for (const x of $$(ATOMS, el)) x.contentEditable = 'false';
  el.contentEditable = 'true';
  el.spellcheck = true;
  S.editing = { kind: 'inline', i, el, before: el.innerHTML, start: b.start, end: b.end };
  showCtx('inline');
  // Started from mousedown (ev given): the browser places the caret at the click itself. From the toolbar: focus and
  // put the caret at the end.
  if (!ev) { el.focus(); placeEnd(el); }
  P.hooks.status();
}
function startTable(i, ev, focus) {
  const b = S.blocks[i], el = blockEl(i);
  el.classList.add('re-editing');
  // Tables: each cell is its own contenteditable (not the whole table), so the structure (rows, cells) cannot be
  // destroyed by typing or selection deletes; structure changes go through tableOp only.
  for (const c of $$('th, td', el)) { c.contentEditable = 'true'; for (const x of $$(ATOMS, c)) x.contentEditable = 'false'; }
  S.editing = { kind: 'table', i, el, fmt: b.type === 'table' ? 'md' : 'html', before: tableKey(el), start: b.start, end: b.end, cell: null };
  showCtx('table');
  const rows = el.querySelector('table').rows;
  const cell = ev?.target?.closest?.('th, td') || (focus ? rows[Math.min(focus[0], rows.length - 1)]?.cells[focus[1]] : null) || el.querySelector('th, td');
  S.editing.cell = cell;
  if (!ev || focus) { cell?.focus(); if (cell) placeEnd(cell); }
  P.hooks.status();
}
// Comparison key ignores the contenteditable attributes this module added itself.
const tableKey = (el) => el.querySelector('table').innerHTML.replace(/ contenteditable="(true|false)"/g, '');

export function commitEdit() {
  // S.editing is cleared before replaceRange, because replaceRange triggers paint(), which is a no-op while editing.
  const E2 = S.editing;
  if (!E2) return;
  if (E2.kind === 'table') {
    const changed = tableKey(E2.el) !== E2.before;
    if (changed) { const m = readTable(E2.el); S.editing = null; hideCtx(); writeTable(E2, m, E2.fmt); return; }
  } else if (E2.el.innerHTML !== E2.before) {
    const md = blockMarkdown(E2.el, E2);
    S.editing = null;
    hideCtx();
    replaceRange(E2.start, E2.end, md);
    return;
  }
  S.editing = null;
  hideCtx();
  paint();
}
export function cancelEdit() {
  if (!S.editing) return;
  S.editing = null;
  hideCtx();
  paint();
}

// --- write-back -------------------------------------------------------------------------------------
const posOf = (x) => { const m = /^(\d+)-(\d+)$/.exec(x.dataset.mdPos || ''); return m ? [+m[1], +m[2]] : null; };
// Replaces the pieces whose source must not change by spans carrying that source (data-md-raw).
// Footnote refs are matched to the source by order of appearance ([^id] occurrences), since the rendered <sup>
// carries only a number. Emoji are written back as their :shortcode: (kept in title by gfm.js).
function rawPieces(root, sess) {
  const src = S.text.slice(sess.start, sess.end);
  const fnRefs = [...src.matchAll(/\[\^[^\]\s]+\]/g)].map((m) => m[0]);
  let fn = 0;
  const raw = (x, text) => { const s = document.createElement('span'); s.dataset.mdRaw = text; x.replaceWith(s); };
  for (const x of $$('a[data-md-pos], picture[data-md-pos], img[data-md-pos], .md-math[data-md-pos]', root)) {
    if (!root.contains(x)) continue;
    if (x.tagName === 'A' && !(x.querySelectorAll('img').length === 1 && !x.textContent.trim())) continue;
    const r = posOf(x);
    if (r) raw(x, S.text.slice(r[0], r[1]));
  }
  for (const x of $$('sup', root)) if (x.querySelector('a.md-fnref')) raw(x, fnRefs[fn++] || '');
  for (const x of $$('.md-emoji', root)) raw(x, x.title || x.textContent);
  for (const x of $$('[data-md-pos]', root)) x.removeAttribute('data-md-pos');
  return root;
}
function blockMarkdown(el, sess) {
  // Works on a clone: the live editor DOM must stay intact if the write-back throws. Alerts are serialised as their
  // body and re-prefixed with "> [!TYPE]" because write.js would emit a plain blockquote.
  const c = rawPieces(el.cloneNode(true), sess);
  const alert = c.querySelector('.markdown-alert');
  if (alert) {
    const type = /markdown-alert-(\w+)/.exec(alert.className)[1];
    alert.querySelector('.markdown-alert-title')?.remove();
    const body = htmlToMarkdown(alert.innerHTML, { gfm: true });
    return [`> [!${type.toUpperCase()}]`, ...body.split('\n').map((l) => (l ? '> ' + l : '>'))].join('\n');
  }
  return htmlToMarkdown(c.innerHTML, { gfm: true });
}

function readTable(el) {
  const rows = [...el.querySelector('table').rows];
  const n = Math.max(...rows.map((r) => r.cells.length));
  const align = Array.from({ length: n }, (_, k) => rows[0].cells[k]?.getAttribute('align') || null);
  // Ragged rows are padded with empty cells: Markdown tables need equal column counts.
  const cells = rows.map((r) => Array.from({ length: n }, (_, k) => (r.cells[k] ? r.cells[k].cloneNode(true) : document.createElement('td'))));
  return { align, cells };
}
// Markdown cells must be single-line: newlines become spaces, trailing <br> from contenteditable are dropped.
const cellMD = (c, sess) => inlineMarkdown(rawPieces(c.cloneNode(true), sess).innerHTML, { gfm: true, cell: true }).replace(/\n/g, ' ').replace(/(<br>)+$/, '').trim();
// HTML cells: math back to its TeX source, images back to their original src (the preview swapped in local
// data/blob URLs), and every attribute this editor or the renderer added (data-*, class, contenteditable) removed.
function cellHTML(c) {
  const x = c.cloneNode(true);
  for (const m of $$('.md-math', x)) { const r = posOf(m); m.replaceWith(document.createTextNode(r ? S.text.slice(r[0], r[1]) : m.textContent)); }
  for (const im of $$('img', x)) { if (im.dataset.orig != null) im.setAttribute('src', im.dataset.orig); im.removeAttribute('title'); im.removeAttribute('class'); }
  for (const e of $$('*', x)) for (const a of [...e.attributes]) if (/^(data-|contenteditable$|class$)/.test(a.name)) e.removeAttribute(a.name);
  return x.innerHTML.replace(/<br>$/, '').trim();
}
function tableText(m, fmt, sess) {
  if (fmt === 'md') {
    const txt = m.cells.map((r) => r.map((c) => cellMD(c, sess) || ' '));
    return tableMarkdown(txt[0], txt.slice(1), m.align, { pad: true, escaped: true });
  }
  const at = (k) => (m.align[k] ? ` align="${m.align[k]}"` : '');
  const row = (r, tag) => '    <tr>\n' + r.map((c, k) => `      <${tag}${at(k)}>${cellHTML(c)}</${tag}>`).join('\n') + '\n    </tr>';
  return `<table>\n  <thead>\n${row(m.cells[0], 'th')}\n  </thead>\n  <tbody>\n${m.cells.slice(1).map((r) => row(r, 'td')).join('\n')}\n  </tbody>\n</table>`;
}
// After a structural change the table is re-rendered from text and a new session is opened on the same cell
// position (focus = [row, col]), so row/column operations feel continuous.
function writeTable(sess, m, fmt, focus) {
  const text = tableText(m, fmt, sess);
  replaceRange(sess.start, sess.end, text);
  if (!focus) return;
  const i = S.blocks.findIndex((b) => b.start === sess.start);
  if (i < 0) return;
  selectBlock(i, { scrollSource: false });
  startTable(i, null, focus);
}
// Row 0 is the header: rows cannot be inserted above it or deleted, and a table keeps at least one body row.
// Every op reads the current table into a model, mutates the model, then writes text and reopens.
function tableOp(op) {
  const E2 = S.editing;
  if (!E2 || E2.kind !== 'table') return;
  const m = readTable(E2.el);
  const act = document.activeElement?.closest?.('th, td');
  const cell = act && E2.el.contains(act) ? act : E2.cell && E2.el.contains(E2.cell) ? E2.cell : E2.el.querySelector('th, td');
  let r = cell.parentElement.rowIndex, c = cell.cellIndex;
  const n = m.align.length, blank = () => document.createElement('td');
  if (op === 'delTable') { S.editing = null; hideCtx(); replaceRange(E2.start, E2.end, ''); return; }
  if (op === 'rowAbove' || op === 'rowBelow') { const at = op === 'rowAbove' ? Math.max(1, r) : r + 1; m.cells.splice(at, 0, Array.from({ length: n }, blank)); r = at; }
  if (op === 'delRow') { if (r === 0 || m.cells.length <= 2) return toast(t('tbl.cantDelete'), 'warn'); m.cells.splice(r, 1); r = Math.min(r, m.cells.length - 1); }
  if (op === 'rowUp' || op === 'rowDown') { const d = op === 'rowUp' ? r - 1 : r + 1; if (r === 0 || d < 1 || d >= m.cells.length) return; [m.cells[r], m.cells[d]] = [m.cells[d], m.cells[r]]; r = d; }
  if (op === 'colLeft' || op === 'colRight') {
    const at = op === 'colLeft' ? c : c + 1;
    m.cells.forEach((row, k) => { const x = blank(); if (!k) x.textContent = t('tbl.column', { n: at + 1 }); row.splice(at, 0, x); });
    m.align.splice(at, 0, null);
    c = at;
  }
  if (op === 'delCol') { if (n <= 1) return; m.cells.forEach((row) => row.splice(c, 1)); m.align.splice(c, 1); c = Math.min(c, n - 2); }
  if (op === 'moveLeft' || op === 'moveRight') {
    const d = op === 'moveLeft' ? c - 1 : c + 1;
    if (d < 0 || d >= n) return;
    m.cells.forEach((row) => { [row[c], row[d]] = [row[d], row[c]]; });
    [m.align[c], m.align[d]] = [m.align[d], m.align[c]];
    c = d;
  }
  if (op.startsWith('al-')) m.align[c] = op.slice(3) || null;
  if (op.startsWith('fmt-')) E2.fmt = op.slice(4);
  S.editing = null;
  writeTable(E2, m, E2.fmt, [r, c]);
}

// --- events -----------------------------------------------------------------------------------------
export function mountEditing(ctxEl) {
  E.ctx = ctxEl;
  // mousedown preventDefault on context bar buttons keeps focus (and the selection) in the editable block.
  ctxEl.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  P.el.addEventListener('focusin', (e) => { if (S.editing?.kind === 'table') { const c = e.target.closest('th, td'); if (c) S.editing.cell = c; } });
  // focusout + setTimeout(0): document.activeElement is only updated after focusout dispatch, so the check must run
  // on the next task. Focus moving into the block, the context bar, a dialog or a popover does not commit.
  P.el.addEventListener('focusout', () => {
    setTimeout(() => {
      const s = S.editing;
      if (!s || s.dialog) return;
      const a = document.activeElement;
      if (s.el.contains(a) || E.ctx.contains(a) || document.querySelector('#ed-overlays .ed-backdrop, #ed-overlays .ed-popover')) return;
      commitEdit();
    }, 0);
  });
  // Escape cancels (stopPropagation so an outer dialog handler does not also react); Ctrl+Enter commits; Enter in a
  // heading commits because a heading is one line. Tab moves between cells and adds a row after the last one.
  P.el.addEventListener('keydown', (e) => {
    const s = S.editing;
    if (!s) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); return; }
    if (s.kind === 'inline' && e.key === 'Enter' && !e.shiftKey && S.blocks[s.i]?.type === 'heading') { e.preventDefault(); commitEdit(); return; }
    if (s.kind === 'inline' && (e.ctrlKey || e.metaKey) && /^[bik]$/i.test(e.key)) { e.preventDefault(); richCmd({ b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()]); return; }
    if (s.kind === 'table' && e.key === 'Tab') {
      e.preventDefault();
      const cells = $$('th, td', s.el), k = cells.indexOf(document.activeElement);
      const nx = cells[k + (e.shiftKey ? -1 : 1)];
      if (nx) { nx.focus(); placeEnd(nx); } else if (!e.shiftKey) tableOp('rowBelow');
    }
  });
  // Paste as plain text: pasted HTML from web pages would bring styles and tags that the Markdown round trip turns
  // into noise. Image pastes (files) are left to main.js.
  P.el.addEventListener('paste', (e) => {
    if (!S.editing || e.clipboardData?.files?.length) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  // Capture-phase mousedown anywhere outside the block, the context bar, overlays or the toolbar commits the session.
  document.addEventListener('mousedown', (e) => {
    if (S.editing && !S.editing.el.contains(e.target) && !e.target.closest('.re-ctx, #ed-overlays, .re-tools')) commitEdit();
  }, true);
}

export { richCmd as editCommand };
