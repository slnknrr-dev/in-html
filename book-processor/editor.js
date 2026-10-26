// book-processor/editor.js - the WYSIWYG chapter editor of the writer. A section (or the title page) is
// rendered with the same book renderer and stylesheet as the reader and EPUB (book/html.js, book/css.js) into a
// contenteditable page; edits are read back into the model with the same HTML parser that imports EPUB chapters
// (blocksFromHTML), so what you see is what the formats get. Block types (paragraph, subtitle, epigraph, citation,
// poem with stanzas, code), inline styles (strong, emphasis, strikethrough, code, sub / superscript, named
// styles), links, footnotes, images, tables and scene breaks; snapshot undo / redo; clean paste.
import { h, caretOffset, setCaret, debounce } from '../ui/dom.js';
import { t, toast } from '../ui/app.js';
import { icon } from '../ui/icons.js';
import { openMenu, promptDialog } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { pickFiles } from '../ui/files.js';
import { blocksFromHTML, parseInline, renderBlocks, renderContext, renderInline, tidyInline } from '../book/html.js';
import { parseMarkup } from '../book/markup.js';
import { cleanInline, isEmptyInline, normalizeBook, sniffImage, inlineText } from '../book/model.js';
import { linkDialog, noteDialog, tableDialog, stylesDialog } from './writer-dialogs.js';

// DESIGN: the model is the truth, the DOM is a view that the user is allowed to edit. Edits flow DOM -> model by
// re-parsing the whole section with the EPUB chapter parser (readBack), never by tracking individual mutations:
// contenteditable produces different markup in every engine, and a mutation-tracking editor has to model all of
// it, while re-parsing only needs to understand the HTML the renderer emits plus the few shapes browsers invent
// (tidyDOM). Cost: a full parse per idle pause (450 ms debounce), cheap for chapter-sized sections.
// Undo is snapshot-based (innerHTML + caret offset) rather than the browser's own stack, because structural changes
// (block type, notes, images) replace DOM wholesale and the native undo stack cannot see them.
const BLOCK_TYPES = ['p', 'subtitle', 'epigraph', 'cite', 'poem', 'code'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// target: { kind: 'section', sec } | { kind: 'front' }
export function mountEditor(host, W, target) {
  const book = W.book;
  const isFront = target.kind === 'front';
  const ctx = () => renderContext({ editable: true, imgSrc: (id) => W.imgs.url(id), lang: book.meta.lang });
  const titleLines = () => (isFront ? book.title : target.sec.title) || [];
  const blocks = () => (isFront ? book.front : target.sec.blocks);
  const barBtns = {}; // toolbar buttons by name (filled when the toolbar is built)

  const titleEl = h('h1', { class: 'wr-title', contenteditable: 'true', spellcheck: 'true', 'data-ph': t(isFront ? 'wr.frontTitlePh' : 'wr.titlePh'), 'aria-label': t(isFront ? 'wr.frontTitle' : 'wr.sectionTitle') });
  const doc = h('div', { class: 'wr-doc', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-ph': t(isFront ? 'wr.frontPh' : 'wr.docPh'), 'aria-label': t('wr.text') });
  const page = h('article', { class: 'wr-page bk-text', lang: book.meta.lang || null }, isFront ? h('p', { class: 'wr-front-note' }, t('wr.frontNote')) : null, titleEl, doc);
  // JSON.stringify makes each translated label a valid CSS string literal (quotes and backslashes escaped) for use
  // in `content: var(--lbl-poem)` (writer.css).
  for (const k of ['poem', 'stanza', 'epigraph', 'cite', 'code', 'image', 'table', 'scene']) page.style.setProperty('--lbl-' + k, JSON.stringify(t('wr.lbl.' + k)));
  doc.style.setProperty('--ph', JSON.stringify(t(isFront ? 'wr.frontPh' : 'wr.docPh')));
  const bar = h('div', { class: 'wr-toolbar', role: 'toolbar', 'aria-label': t('wr.formatting') });
  host.textContent = '';
  host.append(bar, h('div', { class: 'wr-scroll' }, page));

  const render = () => {
    titleEl.innerHTML = titleLines().map((l) => renderInline(l, ctx())).join('<br>');
    const html = renderBlocks(blocks(), ctx());
    doc.innerHTML = html || '<p><br></p>';
    // Empty paragraphs and verses need a line box to take the caret.
    for (const p of doc.querySelectorAll('p:empty, td:empty, th:empty, figcaption:empty')) if (p.tagName !== 'FIGCAPTION') p.append(document.createElement('br'));
  };
  render();
  // Enter creates <p> instead of Chromium's default <div>, so new lines are already in the renderer's vocabulary.
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old engines */ }

  // --- read-back ---------------------------------------------------------------------------------------
  const styleIds = () => new Set(book.styles.map((s) => s.id));
  // Normalises browser-invented shapes before parsing: bare text or inline elements at the top level are wrapped in a
  // <p> together with their following inline siblings, top-level <div>s become <p>. The caret is saved as a character
  // offset and restored, because moving nodes destroys the selection.
  function tidyDOM() {
    // Shapes the browser invents while typing: top-level <div>s, verses without their class, stray text.
    for (const p of doc.querySelectorAll('.stanza > p:not([class]), .stanza > div:not([class])')) p.className = 'verse';
    for (const p of doc.querySelectorAll('p.empty-line')) if (/\S/.test(p.textContent.replace(/ /g, ' '))) p.classList.remove('empty-line');
    const strays = [...doc.childNodes].filter((n) => (n.nodeType === 3 && /\S/.test(n.data)) || (n.nodeType === 1 && n.tagName === 'DIV' && !n.className) || (n.nodeType === 1 && /^(SPAN|B|I|EM|STRONG|A|CODE|S|SUB|SUP|BR)$/.test(n.tagName)));
    if (!strays.length) return;
    const off = document.activeElement === doc ? caretOffset(doc) : -1;
    for (const n of strays) {
      if (n.nodeType === 1 && n.tagName === 'DIV') { const p = document.createElement('p'); p.append(...n.childNodes); n.replaceWith(p); continue; }
      if (n.nodeType === 1 && n.tagName === 'BR' && !n.nextSibling) continue;
      const p = document.createElement('p');
      n.before(p);
      p.append(n);
      // Gather following inline siblings into the same paragraph.
      while (p.nextSibling && (p.nextSibling.nodeType === 3 || /^(SPAN|B|I|EM|STRONG|A|CODE|S|SUB|SUP|BR)$/.test(p.nextSibling.tagName || ''))) p.append(p.nextSibling);
    }
    if (off >= 0) setCaret(doc, off);
  }
  function readBack() {
    tidyDOM();
    let bl = blocksFromHTML(doc.innerHTML, { styles: styleIds(), image: (src, isId) => (isId && book.images[src] ? src : null) });
    // Block ids survive editing; ids the browser copied onto split paragraphs are dropped.
    const seen = new Set();
    // Splitting a paragraph with Enter clones its attributes, including data ids; the second copy loses its id so anchor
    // targets (note references, links) stay unique.
    const dedupe = (b) => { if (b.id) { if (seen.has(b.id)) delete b.id; else seen.add(b.id); } for (const x of b.blocks || []) dedupe(x); for (const x of b.epigraphs || []) dedupe(x); for (const it of b.items || []) it.forEach(dedupe); };
    bl.forEach(dedupe);
    bl = normalizeBook({ sections: [{ id: 'x', blocks: bl }] }).sections[0].blocks;
    // Trailing empty lines are typing leftovers.
    while (bl.length && bl[bl.length - 1].type === 'empty') bl.pop();
    const lines = titleFromDOM();
    if (isFront) { book.title = lines.length ? lines : null; book.front = bl; } else { target.sec.title = lines.length ? lines : null; target.sec.blocks = bl; }
    W.changed({ titles: true });
  }
  function titleFromDOM() {
    const inl = tidyInline(parseInline(parseMarkup(titleEl.innerHTML, { html: true }).children, { anchors: [], styles: styleIds(), image: () => null, link: (x) => (/^(https?:|mailto:|#)/.test(x) ? x : null), noteTarget: () => null }));
    const lines = [[]];
    for (const x of inl) { if (x && x.t === 'br') lines.push([]); else lines[lines.length - 1].push(x); }
    return lines.map((l) => cleanInline(l)).filter((l) => !isEmptyInline(l));
  }
  const sync = debounce(() => { readBack(); snap(); }, 450);

  // --- history -----------------------------------------------------------------------------------------
  const hist = { stack: [], i: -1 };
  // Identical content only updates the caret of the top snapshot (caret moves are not undo steps). Redo history is
  // truncated on a new edit; the stack is capped at 150 to bound memory on long sessions.
  function snap() {
    const s = { title: titleEl.innerHTML, doc: doc.innerHTML, caret: document.activeElement === doc ? caretOffset(doc) : -1 };
    const top = hist.stack[hist.i];
    if (top && top.title === s.title && top.doc === s.doc) { top.caret = s.caret; return; }
    hist.stack.length = hist.i + 1;
    hist.stack.push(s);
    if (hist.stack.length > 150) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    paintBar();
  }
  function restore(s) {
    titleEl.innerHTML = s.title;
    doc.innerHTML = s.doc;
    readBack();
    doc.focus({ preventScroll: true });
    if (s.caret >= 0) setCaret(doc, s.caret);
    paintBar();
  }
  // A pending debounced read-back is flushed first, so the text typed in the last 450 ms becomes its own undo step
  // instead of being lost.
  function undo() { if (sync.pending()) { sync.cancel(); readBack(); snap(); } if (hist.i > 0) { hist.i--; restore(hist.stack[hist.i]); } }
  function redo() { if (hist.i < hist.stack.length - 1) { hist.i++; restore(hist.stack[hist.i]); } }
  snap();
  // Structural changes: one undo step, immediate read-back.
  // Structural edits are bracketed by flush + read-back + snapshot: exactly one undo step, and the model is up to date
  // before any other code (outline, word count) reads it.
  function change(fn) {
    if (sync.pending()) { sync.cancel(); readBack(); snap(); }
    fn();
    readBack();
    snap();
    paintBar();
  }

  // --- selection helpers -------------------------------------------------------------------------------
  const sel = () => getSelection();
  const range = () => { const s = sel(); return s.rangeCount && doc.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null; };
  const topOf = (node) => { let n = node && (node.nodeType === 1 ? node : node.parentNode); while (n && n.parentNode !== doc) n = n.parentNode; return n && n.parentNode === doc ? n : null; };
  function topBlocks() {
    const r = range();
    if (!r) return [];
    const a = topOf(r.startContainer), b = topOf(r.endContainer);
    if (!a) return [];
    const out = [a];
    for (let n = a; n && n !== b; n = n.nextElementSibling) if (n !== a) out.push(n);
    if (b && b !== a) out.push(b);
    return out;
  }
  const caretTo = (el, end = false) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!end);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
  };
  const newP = (html = '<br>') => { const p = document.createElement('p'); p.innerHTML = html; return p; };
  // Inner HTML lines of a block element (paragraphs, verses; <br> splits lines).
  function linesOf(el) {
    if (el.tagName === 'PRE') return el.textContent.split('\n').map(esc);
    const parts = [];
    const take = (x) => { for (const l of x.innerHTML.split(/<br\s*\/?>/i)) if (l.replace(/<[^>]*>/g, '').trim() || /<img/i.test(l)) parts.push(l.trim()); };
    if (el.matches('p, h1, h2, h3, h4, h5, h6, li')) take(el);
    else for (const p of el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')) take(p);
    if (!parts.length && el.textContent.trim()) parts.push(esc(el.textContent.trim()));
    return parts;
  }

  // --- block types ---------------------------------------------------------------------------------------
  function blockTypeAt() {
    const r = range();
    if (!r) return 'p';
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    if (!n) return 'p';
    if (n.closest('.poem')) return 'poem';
    if (n.closest('blockquote.epigraph')) return 'epigraph';
    if (n.closest('blockquote')) return 'cite';
    if (n.closest('pre')) return 'code';
    if (n.closest('p.subtitle')) return 'subtitle';
    return 'p';
  }
  function setBlockType(type) {
    const tops = topBlocks().filter((x) => x.tagName !== 'FIGURE' && x.tagName !== 'HR' && x.tagName !== 'TABLE');
    if (!tops.length) return;
    change(() => {
      const lines = tops.flatMap(linesOf);
      let first;
      if (type === 'p' || type === 'subtitle') {
        const made = (lines.length ? lines : ['<br>']).map((l) => { const p = newP(l || '<br>'); if (type === 'subtitle') p.className = 'subtitle'; return p; });
        tops[0].before(...made);
        first = made[0];
      } else if (type === 'epigraph' || type === 'cite') {
        // Changing the kind of an existing quote keeps its structure.
        if (tops.length === 1 && tops[0].tagName === 'BLOCKQUOTE') { tops[0].className = type; caretTo(tops[0].querySelector('p') || tops[0], true); return; }
        const q = document.createElement('blockquote');
        q.className = type;
        for (const l of lines.length ? lines : ['<br>']) q.append(newP(l));
        tops[0].before(q);
        first = q.querySelector('p');
      } else if (type === 'poem') {
        const poem = document.createElement('div');
        poem.className = 'poem';
        const st = document.createElement('div');
        st.className = 'stanza';
        for (const l of lines.length ? lines : ['<br>']) { const v = newP(l); v.className = 'verse'; st.append(v); }
        poem.append(st);
        tops[0].before(poem);
        first = st.firstChild;
      } else if (type === 'code') {
        const pre = document.createElement('pre');
        pre.className = 'code';
        const code = document.createElement('code');
        const tmp = document.createElement('div');
        code.textContent = lines.map((l) => { tmp.innerHTML = l; return tmp.textContent; }).join('\n') || '\n';
        pre.append(code);
        tops[0].before(pre);
        first = code;
      }
      for (const x of tops) x.remove();
      if (first) caretTo(first, true);
    });
  }

  // --- inline formatting -------------------------------------------------------------------------------
  function exec(cmd, arg = null) {
    doc.focus({ preventScroll: true });
    try { document.execCommand('styleWithCSS', false, false); } catch { /* ignore */ }
    document.execCommand(cmd, false, arg);
    sync();
    paintBar();
  }
  function wrapInline(tag, cls) {
    const r = range();
    if (!r || r.collapsed) { toast(t('wr.selectFirst'), 'info'); return; }
    change(() => {
      const anc = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest(cls ? `span.${cls}` : tag);
      if (anc && doc.contains(anc)) { anc.replaceWith(...anc.childNodes); return; } // toggle off
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.append(r.extractContents());
      r.insertNode(el);
      const s = sel();
      s.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(el);
      s.addRange(nr);
    });
  }
  function clearFormat() {
    const r = range();
    if (!r) return;
    change(() => {
      document.execCommand('removeFormat');
      const r2 = range();
      if (!r2) return;
      for (const el of [...doc.querySelectorAll('code, span[class^="s-"], span[class*=" s-"], b, i, strong, em, s, strike, sub, sup')]) {
        if (el.closest('pre')) continue;
        if (r2.intersectsNode(el)) el.replaceWith(...el.childNodes);
      }
    });
  }
  function setBlockStyle(id) {
    const tops = topBlocks().filter((x) => x.tagName === 'P');
    if (!tops.length) return;
    change(() => {
      for (const p of tops) {
        for (const c of [...p.classList]) if (c.startsWith('s-')) p.classList.remove(c);
        if (id) p.classList.add('s-' + id);
      }
    });
  }

  // --- inserts -------------------------------------------------------------------------------------------
  function insertAfterTop(...nodes) {
    const r = range();
    const top = r ? topOf(r.endContainer) : doc.lastElementChild;
    if (top) top.after(...nodes); else doc.append(...nodes);
  }
  function insertScene() {
    change(() => {
      const hr = document.createElement('hr');
      hr.className = 'scene-break';
      const p = newP();
      insertAfterTop(hr, p);
      caretTo(p);
    });
  }
  async function insertImage() {
    const files = await pickFiles({ accept: 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml' });
    if (!files.length) return;
    const f = files[0];
    const data = new Uint8Array(await f.arrayBuffer());
    const type = sniffImage(data) || f.type;
    if (!/^image\//.test(type)) { toast(t('wr.notImage'), 'error'); return; }
    const id = W.addImage(data, type, f.name);
    insertImageId(id, f.name.replace(/\.[a-z0-9]+$/i, ''));
  }
  function insertImageId(id, alt = '') {
    doc.focus({ preventScroll: true });
    change(() => {
      const holder = document.createElement('div');
      holder.innerHTML = renderBlocks([{ type: 'image', src: id, alt, title: [] }], ctx());
      const fig = holder.firstElementChild;
      const p = newP();
      insertAfterTop(fig, p);
      caretTo(p);
    });
  }
  async function insertTable() {
    const r = range();
    const cell = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('td, th');
    if (cell && doc.contains(cell)) { tableMenu(cell); return; }
    const o = await tableDialog();
    if (!o) return;
    doc.focus({ preventScroll: true });
    if (r) { const s = sel(); s.removeAllRanges(); s.addRange(r); }
    change(() => {
      const table = document.createElement('table');
      for (let i = 0; i < o.rows; i++) {
        const tr = document.createElement('tr');
        for (let j = 0; j < o.cols; j++) { const c = document.createElement(i === 0 && o.header ? 'th' : 'td'); c.innerHTML = '<br>'; tr.append(c); }
        table.append(tr);
      }
      const p = newP();
      insertAfterTop(table, p);
      caretTo(table.querySelector('th, td'));
    });
  }
  function tableMenu(cell) { openMenu(barBtns.table, tableItems(cell)); }
  function tableItems(cell) {
    const tr = cell.parentElement, table = cell.closest('table');
    const col = [...tr.children].indexOf(cell);
    const rows = () => [...table.querySelectorAll('tr')];
    const mk = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
    return [
      { label: t('wr.tbl.rowBelow'), icon: 'plus', action: () => change(() => { const n = document.createElement('tr'); for (let i = 0; i < tr.children.length; i++) n.append(mk('td')); tr.after(n); }) },
      { label: t('wr.tbl.colRight'), icon: 'plus', action: () => change(() => { for (const r of rows()) { const ref = r.children[col]; const c = mk(ref && ref.tagName === 'TH' ? 'th' : 'td'); if (ref) ref.after(c); else r.append(c); } }) },
      { label: t('wr.tbl.header'), icon: 'heading', action: () => change(() => { const first = rows()[0]; for (const c of [...first.children]) { const n = mk(c.tagName === 'TH' ? 'td' : 'th'); n.innerHTML = c.innerHTML; c.replaceWith(n); } }) },
      { sep: true },
      { label: t('wr.tbl.delRow'), icon: 'minus', action: () => change(() => { if (rows().length > 1) tr.remove(); else table.remove(); }) },
      { label: t('wr.tbl.delCol'), icon: 'minus', action: () => change(() => { for (const r of rows()) r.children[col]?.remove(); if (!table.querySelector('td, th')) table.remove(); }) },
      { label: t('wr.tbl.delete'), icon: 'trash', danger: true, action: () => change(() => table.remove()) },
    ];
  }
  async function insertLink() {
    const r = range();
    const a = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('a');
    const cur = a && doc.contains(a) && !a.classList.contains('noteref') ? (a.dataset.href || a.getAttribute('href') || '') : '';
    if (!cur && (!r || r.collapsed)) { toast(t('wr.selectFirst'), 'info'); return; }
    const href = await linkDialog(W, cur);
    if (href == null) return;
    doc.focus({ preventScroll: true });
    if (r) { const s = sel(); s.removeAllRanges(); s.addRange(r); }
    change(() => {
      if (a && doc.contains(a)) { if (href) { a.setAttribute('href', href); a.dataset.href = href; } else a.replaceWith(...a.childNodes); return; }
      if (!href) return;
      document.execCommand('createLink', false, href);
      const s = sel();
      const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
      const link = n && (n.closest('a') || n.querySelector?.('a'));
      if (link) link.dataset.href = href;
    });
  }
  async function insertNote() {
    const r = range();
    if (!r) { doc.focus(); toast(t('wr.placeCaret'), 'info'); return; }
    const note = W.addNote();
    change(() => {
      const rr = r.cloneRange();
      rr.collapse(false);
      const holder = document.createElement('span');
      holder.innerHTML = renderInline([{ t: 'note', ref: note.id, c: note.label }], ctx());
      const a = holder.firstChild;
      rr.insertNode(a);
      const s = sel();
      const after = document.createRange();
      after.setStartAfter(a);
      after.collapse(true);
      s.removeAllRanges();
      s.addRange(after);
    });
    await editNote(note.id, true);
  }
  async function editNote(id, fresh = false) {
    const res = await noteDialog(W, id, { fresh });
    if (res === 'deleted') change(() => { for (const a of doc.querySelectorAll(`a.noteref[data-note="${CSS.escape(id)}"]`)) a.remove(); });
    else if (res) change(() => { const n = book.notes.find((x) => x.id === id); for (const a of doc.querySelectorAll(`a.noteref[data-note="${CSS.escape(id)}"]`)) a.innerHTML = renderInline(n.label, ctx()); });
  }

  // --- toolbar -------------------------------------------------------------------------------------------
  const tb = (key, ic, label, fn, kbd = '') => {
    const b = h('button', { type: 'button', class: 'wr-tb', title: label + (kbd ? ` (${kbd})` : ''), 'aria-label': label, onmousedown: (e) => e.preventDefault(), onclick: fn, html: icon(ic) });
    barBtns[key] = b;
    return b;
  };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const K = (k) => (mac ? '⌘' : 'Ctrl+') + k;
  const typeSel = h('select', { class: 'ed-input ed-select wr-type', 'aria-label': t('wr.blockType'), title: t('wr.blockType') },
    BLOCK_TYPES.map((ty) => h('option', { value: ty }, t('wr.type.' + ty))));
  typeSel.addEventListener('change', () => { setBlockType(typeSel.value); doc.focus({ preventScroll: true }); });
  const styleSel = h('select', { class: 'ed-input ed-select wr-style', 'aria-label': t('wr.paraStyle'), title: t('wr.paraStyle') });
  const fillStyles = () => {
    styleSel.textContent = '';
    styleSel.append(h('option', { value: '' }, t('wr.noStyle')));
    for (const s of book.styles.filter((x) => x.kind === 'block')) styleSel.append(h('option', { value: s.id }, s.name));
    styleSel.append(h('option', { value: '__manage' }, t('wr.manageStyles')));
  };
  fillStyles();
  styleSel.addEventListener('change', async () => {
    if (styleSel.value === '__manage') { styleSel.value = ''; if (await stylesDialog(W)) { fillStyles(); W.refreshStyles(); } return; }
    setBlockStyle(styleSel.value);
    doc.focus({ preventScroll: true });
  });
  const inlineStyleBtn = tb('istyle', 'palette', t('wr.inlineStyle'), (e) => {
    const items = book.styles.filter((x) => x.kind === 'inline').map((s) => ({ label: s.name, action: () => wrapInline('span', 's-' + s.id) }));
    items.push({ sep: true }, { label: t('wr.manageStyles'), icon: 'settings', action: async () => { if (await stylesDialog(W)) { fillStyles(); W.refreshStyles(); } } });
    openMenu(e.currentTarget, items);
  });
  const grp = (...k) => h('div', { class: 'wr-tb-grp' }, ...k);
  bar.append(
    grp(tb('undo', 'undo', t('wr.undo'), undo, K('Z')), tb('redo', 'redo', t('wr.redo'), redo, K('Y'))),
    grp(typeSel, styleSel),
    grp(tb('bold', 'bold', t('wr.bold'), () => exec('bold'), K('B')), tb('italic', 'italic', t('wr.italic'), () => exec('italic'), K('I')),
      tb('strike', 'strike', t('wr.strike'), () => exec('strikeThrough')), tb('code', 'code', t('wr.code'), () => wrapInline('code')),
      tb('sub', 'sub', t('wr.sub'), () => exec('subscript')), tb('sup', 'sup', t('wr.sup'), () => exec('superscript')), inlineStyleBtn,
      tb('clear', 'clearFormat', t('wr.clear'), clearFormat)),
    grp(tb('link', 'link', t('wr.link'), insertLink, K('K')), tb('note', 'footnote', t('wr.footnote'), insertNote, (mac ? '⌘⌥' : 'Ctrl+Alt+') + 'F'),
      tb('image', 'image', t('wr.image'), insertImage), tb('table', 'table', t('wr.table'), insertTable), tb('scene', 'scene', t('wr.scene'), insertScene)),
  );
  function paintBar() {
    if (!barBtns.undo) return;
    barBtns.undo.disabled = hist.i <= 0;
    barBtns.redo.disabled = hist.i >= hist.stack.length - 1;
    const r = range();
    if (!r) return;
    typeSel.value = blockTypeAt();
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const p = n && n.closest('p');
    const st = p && [...p.classList].find((c) => c.startsWith('s-'));
    styleSel.value = st ? st.slice(2) : '';
    for (const [k, cmd] of [['bold', 'bold'], ['italic', 'italic'], ['strike', 'strikeThrough'], ['sub', 'subscript'], ['sup', 'superscript']]) {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch { /* ignore */ }
      barBtns[k].classList.toggle('wr-on', on);
      barBtns[k].setAttribute('aria-pressed', String(on));
    }
    barBtns.code.classList.toggle('wr-on', !!(n && n.closest('code')));
  }
  paintBar();

  // --- context menu (right click, long press, Menu key) on images, tables, notes, links and scene breaks ----
  // Plain text keeps the browser's own menu (spelling suggestions, copy / paste).
  function selectNode(el) { const r = document.createRange(); r.selectNodeContents(el); const s = sel(); s.removeAllRanges(); s.addRange(r); }
  function ctxItems(target, info) {
    const ev = info.event && info.event.target instanceof Element ? info.event.target : target;
    if (target.matches('figure.image')) {
      const img = target.querySelector('img');
      const id = img && img.dataset.id;
      return [
        { header: true, label: t('wr.lbl.image') },
        { label: t('wr.img.alt'), icon: 'edit', action: async () => {
          const v = await promptDialog(t('wr.img.alt'), t('wr.img.altLabel'), img ? img.getAttribute('alt') || '' : '');
          if (v != null && img) change(() => img.setAttribute('alt', v));
        } },
        { label: t('wr.img.caption'), icon: 'type', action: () => { const fc = target.querySelector('figcaption'); if (fc) { fc.focus(); caretTo(fc, true); } } },
        id && W.setCover ? { label: t('wr.img.cover'), icon: 'book', action: () => W.setCover(id) } : null,
        { sep: true },
        { label: t('wr.img.remove'), icon: 'trash', danger: true, action: () => change(() => target.remove()) },
      ];
    }
    if (target.matches('table')) {
      const cell = ev.closest('td, th') || target.querySelector('td, th');
      return cell ? [{ header: true, label: t('wr.lbl.table') }, ...tableItems(cell)] : null;
    }
    if (target.matches('a.noteref')) {
      const id = target.dataset.note;
      return [
        { header: true, label: t('wr.footnote') + ' ' + target.textContent },
        { label: t('wr.note.edit'), icon: 'edit', action: () => editNote(id) },
        { label: t('wr.note.unlink'), icon: 'link', action: () => change(() => target.remove()) },
        { sep: true },
        { label: t('wr.note.delete'), icon: 'trash', danger: true, action: () => {
          book.notes = book.notes.filter((n) => n.id !== id);
          change(() => { for (const a of doc.querySelectorAll(`a.noteref[data-note="${CSS.escape(id)}"]`)) a.remove(); });
          W.changed({ notes: true });
        } },
      ];
    }
    if (target.matches('a[href]')) {
      const href = target.dataset.href || target.getAttribute('href') || '';
      return [
        { header: true, label: href.length > 48 ? href.slice(0, 47) + '…' : href },
        { label: t('wr.link.edit'), icon: 'link', action: () => { selectNode(target); insertLink(); } },
        href.startsWith('#') && W.goToId ? { label: t('wr.link.go'), icon: 'arrowRight', action: () => W.goToId(href.slice(1)) } : null,
        { label: t('wr.link.remove'), icon: 'close', action: () => change(() => target.replaceWith(...target.childNodes)) },
      ];
    }
    if (target.matches('hr.scene-break')) return [{ label: t('wr.scene.remove'), icon: 'trash', danger: true, action: () => change(() => target.remove()) }];
    return null;
  }
  const detachCtx = contextMenu(page, ctxItems, { selector: '.wr-doc figure.image, .wr-doc table, .wr-doc a.noteref, .wr-doc a[href], .wr-doc hr.scene-break', fields: true });

  // Splits the open section before the top-level block that holds the caret: { before, after } blocks (null when
  // the caret is not in the text or in its first block).
  let lastRange = null;
  function splitAtCaret() {
    flush();
    const r = range() || (lastRange && doc.contains(lastRange.startContainer) ? lastRange : null);
    const top = r && topOf(r.startContainer);
    const i = top ? [...doc.children].indexOf(top) : -1;
    if (i <= 0) return null;
    const html = (els) => els.map((e) => e.outerHTML).join('\n');
    const parse = (s) => normalizeBook({ sections: [{ id: 'x', blocks: blocksFromHTML(s, { styles: styleIds(), image: (src, isId) => (isId && book.images[src] ? src : null) }) }] }).sections[0].blocks;
    const kids = [...doc.children];
    return { before: parse(html(kids.slice(0, i))), after: parse(html(kids.slice(i))) };
  }

  // --- events --------------------------------------------------------------------------------------------
  const onSel = debounce(() => { const r = range(); if (r) { lastRange = r.cloneRange(); paintBar(); } }, 80);
  document.addEventListener('selectionchange', onSel);
  doc.addEventListener('input', () => sync());
  titleEl.addEventListener('input', () => sync());
  // The browser's own undo (menu, gesture: historyUndo) is redirected to the snapshot history, otherwise both stacks
  // would fight and corrupt the document.
  doc.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
  });
  titleEl.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
  });
  const keys = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return true; }
    if (mod && !e.altKey && k === 'y') { e.preventDefault(); redo(); return true; }
    if (mod && !e.altKey && k === 'k') { e.preventDefault(); insertLink(); return true; }
    if (mod && e.altKey && k === 'f') { e.preventDefault(); insertNote(); return true; }
    if (mod && !e.altKey && k === 's') { e.preventDefault(); flush(); W.saveNow(true); return true; }
    return false;
  };
  titleEl.addEventListener('keydown', (e) => {
    if (keys(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doc.focus(); caretTo(doc.firstElementChild || doc); }
  });
  titleEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ').trim();
    if (text) document.execCommand('insertText', false, text);
  });
  doc.addEventListener('keydown', (e) => {
    if (keys(e)) return;
    const r = range();
    if (!r) return;
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    if (e.key === 'Tab') {
      const cell = n.closest('td, th');
      if (cell) {
        e.preventDefault();
        const cells = [...cell.closest('table').querySelectorAll('td, th')];
        const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
        if (cells[i]) caretTo(cells[i], true);
        return;
      }
    }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const pre = n.closest('pre');
    if (pre) {
      e.preventDefault();
      const code = pre.querySelector('code') || pre;
      const atEnd = r.collapsed && caretOffset(code) === code.textContent.length;
      if (atEnd && code.textContent.endsWith('\n\n')) { change(() => { code.textContent = code.textContent.replace(/\n+$/, ''); const p = newP(); pre.after(p); caretTo(p); }); return; }
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (n.closest('figcaption')) { e.preventDefault(); change(() => { const fig = n.closest('figure'); const p = newP(); fig.after(p); caretTo(p); }); return; }
    const verse = n.closest('p.verse');
    if (verse && !verse.textContent.trim() && r.collapsed) {
      e.preventDefault();
      change(() => {
        const st = verse.parentElement;
        const poem = verse.closest('.poem');
        const lines = st.querySelectorAll('p.verse');
        if (lines.length === 1) {
          // An empty new stanza: leave the poem.
          st.remove();
          const p = newP();
          poem.after(p);
          caretTo(p);
          if (!poem.querySelector('.stanza')) poem.remove();
        } else {
          const ns = document.createElement('div');
          ns.className = 'stanza';
          const after = [];
          for (let x = verse.nextElementSibling; x; x = x.nextElementSibling) after.push(x);
          verse.remove();
          const nv = newP();
          nv.className = 'verse';
          ns.append(nv, ...after);
          st.after(ns);
          caretTo(nv);
        }
      });
      return;
    }
    const q = n.closest('blockquote');
    const qp = q && n.closest('p');
    if (q && qp && !qp.textContent.trim() && r.collapsed && !qp.nextElementSibling) {
      e.preventDefault();
      change(() => { qp.remove(); const p = newP(); q.after(p); caretTo(p); if (!q.querySelector('p')) q.remove(); });
    }
  });
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.noteref');
    if (a && doc.contains(a)) { e.preventDefault(); editNote(a.dataset.note); return; }
    if (e.target.closest && e.target.closest('a')) e.preventDefault();
  });
  // Clean paste: clipboard HTML goes through the same parser as imports, so only book semantics survive (no fonts,
  // colours, spans from Word or web pages). The Windows clipboard's StartFragment / EndFragment markers are cut so
  // surrounding page chrome is not pasted. Inside code blocks only plain text is inserted. execCommand insertHTML is
  // used (deprecated but universal) because it keeps the native undo / caret behaviour that range APIs do not.
  doc.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...(cd.files || [])].filter((f) => /^image\//.test(f.type));
    e.preventDefault();
    if (files.length) {
      files[0].arrayBuffer().then((buf) => { const data = new Uint8Array(buf); insertImageId(W.addImage(data, sniffImage(data) || files[0].type, files[0].name || 'image'), ''); });
      return;
    }
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    let bl;
    if (html) bl = blocksFromHTML(html.replace(/^[\s\S]*<!--StartFragment-->|<!--EndFragment-->[\s\S]*$/g, ''), { styles: styleIds(), editor: false, image: (src, isId) => (isId && book.images[src] ? src : null) });
    else bl = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => ({ type: 'p', c: [x.trim()] }));
    bl = normalizeBook({ sections: [{ id: 'x', blocks: bl }] }).sections[0].blocks.filter((b) => b.type !== 'empty');
    if (!bl.length) return;
    const into = r0();
    if (bl.length === 1 && bl[0].type === 'p') document.execCommand('insertHTML', false, renderInline(bl[0].c, ctx()));
    else if (into && into.closest('pre')) document.execCommand('insertText', false, bl.map((b) => inlineText(b.c || [])).join('\n'));
    else document.execCommand('insertHTML', false, renderBlocks(bl, ctx()));
    sync();
  });
  const r0 = () => { const r = range(); return r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement); };
  doc.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    // caretRangeFromPoint exists in Chromium and Safari; Firefox has only caretPositionFromPoint, so there the image is
    // inserted at the previous caret instead of the drop point.
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (pos) { const s = sel(); s.removeAllRanges(); s.addRange(pos); }
    files[0].arrayBuffer().then((buf) => { const data = new Uint8Array(buf); insertImageId(W.addImage(data, sniffImage(data) || files[0].type, files[0].name), files[0].name.replace(/\.[a-z0-9]+$/i, '')); });
  });

  function flush() { if (sync.pending()) { sync.cancel(); readBack(); snap(); } }
  return {
    flush,
    // selectionchange is a document-level listener and must be removed, or each mounted chapter would keep one alive.
    destroy() { flush(); document.removeEventListener('selectionchange', onSel); detachCtx(); },
    splitAtCaret,
    hasCaret: () => !!(range() || (lastRange && doc.contains(lastRange.startContainer))),
    focus() { (target.kind === 'section' && !target.sec.title ? titleEl : doc).focus({ preventScroll: true }); },
    focusTitle() { titleEl.focus(); caretTo(titleEl, true); },
    insertImageId,
    rerender() { flush(); render(); snap(); },
    setBlockType, exec, undo, redo, insertScene, insertNote,
    el: { doc, titleEl, page, bar },
  };
}

