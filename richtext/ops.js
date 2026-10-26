// richtext/ops.js - editing operations on a field element and a Range (inline formats, block styles, lists,
// indents, alignment) and the command runner for single fields and multi-cell table selections.
import { t } from '../ui/i18n.js';
import { S } from '../studio/state.js';
import { findBlock, setField } from '../studio/doc.js';
import { commit } from '../studio/history.js';
import { RT_FMT_TAGS, RT_S, RT_ZW, rtIsBlockNode, sanitizeHTML } from './sanitize.js';
import { rtActive, rtCommitNow, rtFlush, rtKind, rtMark, rtMarkRange, rtNormalizeEl, rtRestoreSel, rtSchedule, rtSetRange, rtUnwrap, rtUp } from './field.js';
import { rtSchedUpdate } from './toolbar.js';
import { rtLinkDialog } from './link.js';
import { TBL_S, tblMultiCells } from './table-ui.js';
import { P } from '../doc/product.js';

//
// Why own DOM operations instead of document.execCommand: execCommand is deprecated, differs per engine (Chrome
// emits <b> or <span style=font-weight>, Firefox <b>, Safari nests spans), cannot toggle across table cells, and
// produces markup the sanitizer then has to rewrite. Here every op works on whole TEXT NODES of the range: split
// the boundary text nodes, then wrap/strip ancestors per text node. Simple, engine-independent, and the sanitizer's
// merge pass afterwards (rtMergeSiblings) re-joins the fragments into minimal markup.
// execCommand remains only where it is strictly better: collapsed-caret pending styles (typing continues bold),
// createLink across element boundaries, and insertText (keeps the browser's own undo/IME behaviour).
// ---------- Editing operations (operate on a field element + Range) ----------

/** Split text nodes at the range boundaries so the range covers whole text nodes. */
// End boundary first: splitting the start text node first would invalidate the end offset when both boundaries are
// in the same node (handled explicitly for that case: ec becomes the tail, eo shifts by so).
function rtSplitBounds(range) {
  let sc = range.startContainer;
  let so = range.startOffset;
  let ec = range.endContainer;
  let eo = range.endOffset;
  if (ec.nodeType === 3 && eo > 0 && eo < ec.length) ec.splitText(eo);
  if (sc.nodeType === 3 && so > 0 && so < sc.length) {
    const tail = sc.splitText(so);
    if (ec === sc) { ec = tail; eo -= so; }
    sc = tail;
    so = 0;
  }
  range.setStart(sc, so);
  range.setEnd(ec, eo);
}
function rtIsContainer(el, f) {
  if (el === f) return rtKind(f) === 'rich';
  return /^(ul|ol|table|tbody|thead|tr)$/.test(el.localName) ||
    (el.localName === 'blockquote' && [...el.children].some(rtIsBlockNode));
}
/** Text nodes fully inside range (after boundary split), skipping inter-block whitespace. */
// Whitespace-only text between blocks (indentation of serialized HTML inside ul/ol/blockquote) is skipped:
// wrapping it in <strong> would create invalid inline content directly inside a list.
function rtTexts(f, range) {
  rtSplitBounds(range);
  const out = [];
  const w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.length || !range.intersectsNode(n)) continue;
    if (n === range.startContainer && range.startOffset >= n.length) continue;
    if (n === range.endContainer && range.endOffset === 0) continue;
    if (!/\S|\u00a0/.test(n.data) && rtIsContainer(n.parentNode, f)) continue;
    out.push(n);
  }
  return out;
}
/** Expand a collapsed range to the word around it. Returns true when expanded. */
// Unicode-aware word: letters/digits of any script (\p{L}, \p{N}), apostrophes and hyphens ("don't", "Jean-Luc").
function rtExpandWord(range) {
  const n = range.startContainer;
  if (!range.collapsed || n.nodeType !== 3) return false;
  const s = n.data;
  const isW = (ch) => /[\p{L}\p{N}_'\u2019-]/u.test(ch);
  let a = range.startOffset;
  let b = a;
  while (a > 0 && isW(s[a - 1])) a--;
  while (b < s.length && isW(s[b])) b++;
  if (a === b) return false;
  range.setStart(n, a);
  range.setEnd(n, b);
  return true;
}
function rtHasContent(frag) {
  return frag.textContent !== '' || !!(frag.querySelector && frag.querySelector('br,hr,[data-rt-mark]'));
}
/** Split ancestors between node and anc (inclusive) so that anc ends up containing only node's path. */
// Splits ancestor `anc` into up to three copies (before / around node / after) using Range.extractContents, which
// clones the partially selected ancestors automatically. After this, unwrapping `anc` affects only `node`, so
// "un-bold one word inside a bold sentence" leaves the rest bold.
function rtIsolate(node, anc) {
  const par = anc.parentNode;
  let r = document.createRange();
  r.setStartBefore(anc);
  r.setEndBefore(node);
  let frag = r.extractContents();
  if (rtHasContent(frag)) par.insertBefore(frag, anc);
  r = document.createRange();
  r.setStartAfter(node);
  r.setEndAfter(anc);
  frag = r.extractContents();
  if (rtHasContent(frag)) par.insertBefore(frag, anc.nextSibling);
}
/** Remove ancestors of text node t matching pred (isolating t first). fix(el) does the removal. */
// Removes every matching ancestor of t up to the field: isolate at the TOPMOST match so nested matches
// (<strong><em><strong>) are all inside the isolated copy, then fix each one on the way up.
function rtStrip(t, f, pred, fix = rtUnwrap) {
  let top = null;
  for (let a = t.parentNode; a && a !== f; a = a.parentNode) if (pred(a)) top = a;
  if (!top) return;
  rtIsolate(t, top);
  for (let a = t.parentNode; a && a !== f;) {
    const up = a.parentNode;
    const stop = a === top;
    if (pred(a)) fix(a);
    if (stop) break;
    a = up;
  }
}
function rtWrap(n, tag, attrs = {}) {
  const w = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) w.setAttribute(k, v);
  n.before(w);
  w.append(n);
  return w;
}

// Toggle detection treats legacy synonyms as the same format (a pasted <b> counts as bold), so "un-bold" also
// removes <b>; the sanitizer would rename them anyway.
const RT_TAG_ALIAS = { strong: ['strong', 'b'], em: ['em', 'i'], u: ['u', 'ins'], s: ['s', 'strike', 'del'],
  sub: ['sub'], sup: ['sup'], code: ['code'], mark: ['mark'] };
function rtInTag(n, f, tag) {
  const al = RT_TAG_ALIAS[tag] || [tag];
  return rtUp(n, f, (a) => al.includes(a.localName));
}
/** Are all text nodes in range inside tag? (decides toggle direction for multi-cell selections) */
function rtAllIn(f, range, tag) {
  const ts = rtTexts(f, range);
  return ts.length > 0 && ts.every((n) => rtInTag(n, f, tag));
}
/** Toggle an inline formatting tag on the range. force: true = apply, false = remove, undefined = toggle. */
// Word-processor toggle semantics: if every text node is already formatted, remove; otherwise apply to all. sup and
// sub are mutually exclusive, applying one strips the other.
function rtToggleTag(f, range, tag, force) {
  const texts = rtTexts(f, range);
  if (!texts.length) return;
  const on = force ?? !texts.every((n) => rtInTag(n, f, tag));
  const al = RT_TAG_ALIAS[tag] || [tag];
  for (const n of texts) {
    if (on) {
      if (tag === 'sup' || tag === 'sub') {
        const other = tag === 'sup' ? 'sub' : 'sup';
        rtStrip(n, f, (a) => a.localName === other);
      }
      if (!rtInTag(n, f, tag)) rtWrap(n, tag);
    } else rtStrip(n, f, (a) => al.includes(a.localName));
  }
}
/** Set (val) or remove ('') one span style property on the range: color | background-color | font-size. */
// One property per operation: existing spans that set the same property are stripped (other properties on the
// same span survive, the span is unwrapped only when its style becomes empty), then a fresh span is applied.
// Highlight also removes <mark>, which renders as a background too.
function rtSetStyle(f, range, prop, val) {
  for (const n of rtTexts(f, range)) {
    rtStrip(n, f,
      (a) => (a.localName === 'span' && !!a.style.getPropertyValue(prop)) || (prop === 'background-color' && a.localName === 'mark'),
      (a) => {
        if (a.localName === 'mark') { rtUnwrap(a); return; }
        a.style.removeProperty(prop);
        if (!a.style.length) rtUnwrap(a);
      });
    if (val) {
      const sp = document.createElement('span');
      sp.style.setProperty(prop, val);
      n.before(sp);
      sp.append(n);
    }
  }
}
/** Collapsed caret outside a word: insert a styled zero-width span so typing continues in that style. */
// A caret has no text to style; a styled span holding a zero-width space gives the caret a home so the next typed
// characters inherit the style. The ZWSP is stripped by the sanitizer on commit (RT_ZW).
function rtStyleCaret(f, range, prop, val) {
  if (!val) return;
  const sp = document.createElement('span');
  sp.style.setProperty(prop, val);
  const tx = document.createTextNode('\u200B');
  sp.append(tx);
  range.insertNode(sp);
  const r = document.createRange();
  r.setStart(tx, 1);
  r.collapse(true);
  rtSetRange(r);
}
/** Leaf text blocks (p/h3/h4/pre/li/inline blockquote) intersecting the range — innermost only. */
// Innermost text blocks only: a <li> containing a nested list intersects the range too, but block operations
// must act on the leaf the user selected, not twice on parent and child.
function rtLeaves(f, range) {
  const all = [...f.querySelectorAll('p,h3,h4,pre,li,blockquote')].filter((b) => {
    if (!range.intersectsNode(b)) return false;
    return b.localName !== 'blockquote' || ![...b.children].some(rtIsBlockNode);
  });
  return all.filter((b) => !all.some((o) => o !== b && b.contains(o)));
}
// Changing a block's tag requires a new element (tagName is read-only); alignment and indent class are carried
// over explicitly because those are the only block attributes the model allows.
function rtRename(el, tag) {
  if (el.localName === tag) return el;
  const n = document.createElement(tag);
  const st = el.getAttribute('style');
  const al = st && /text-align:\s*(left|center|right|justify)/i.exec(st);
  if (al) n.setAttribute('style', 'text-align:' + al[1].toLowerCase());
  const cls = el.getAttribute('class');
  if (cls && /^(p|h3|h4)$/.test(tag)) n.setAttribute('class', cls);
  n.append(...el.childNodes);
  el.replaceWith(n);
  return n;
}
/** Wrap loose inline content at the root of a rich field into <p>; div → p. */
// Normalizes what contenteditable creates natively (Chrome inserts <div> on Enter in some states, bare text at
// the root after select-all + type) into the <p>-only block model before an operation runs.
function rtWrapLoose(f) {
  if (rtKind(f) !== 'rich') return;
  for (const dv of [...f.children]) {
    if (dv.localName !== 'div') continue;
    if ([...dv.children].some((c) => rtIsBlockNode(c) || c.localName === 'div')) rtUnwrap(dv);
    else rtRename(dv, 'p');
  }
  let run = [];
  const flush = () => {
    if (run.some((n) => (n.nodeType === 3 ? n.data.replace(RT_ZW, '').trim() !== '' || n.data.includes('\u00a0') : true))) {
      const p = document.createElement('p');
      run[0].before(p);
      p.append(...run);
    }
    run = [];
  };
  for (const c of [...f.childNodes]) {
    if (rtIsBlockNode(c)) flush(); else run.push(c);
  }
  flush();
}
/** Paragraph style: p | h3 | h4 | pre | blockquote. List items keep their list. */
function rtSetBlock(f, range, tag) {
  const leaves = rtLeaves(f, range).filter((b) => b.localName !== 'li');
  if (tag === 'blockquote') {
    const todo = leaves.filter((b) => b.localName !== 'blockquote' && !rtUp(b.parentNode, f, (a) => a.localName === 'blockquote'));
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const q = document.createElement('blockquote');
      group[0].before(q);
      q.append(...group);
      group = [];
    };
    for (const b of todo) {
      const prev = group[group.length - 1];
      if (prev && prev.nextElementSibling !== b) flush();
      group.push(b);
    }
    flush();
    return;
  }
  for (let b of leaves) {
    if (b.localName === 'blockquote') { rtRename(b, tag); continue; }
    b = rtRename(b, tag);
    const q = rtUp(b.parentNode, f, (a) => a.localName === 'blockquote');
    if (q) { rtIsolate(b, q); rtUnwrap(q); }
  }
}
function rtSetAlign(f, range, al) {
  for (const b of rtLeaves(f, range)) {
    b.style.textAlign = al === 'left' ? '' : al;
    if (!b.getAttribute('style')) b.removeAttribute('style');
  }
}
function rtLiIndent(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.localName !== 'li') return false;
  const L = li.parentNode;
  let sub = prev.lastElementChild;
  if (!sub || !/^(ul|ol)$/.test(sub.localName)) { sub = document.createElement(L.localName); prev.append(sub); }
  sub.append(li);
  return true;
}
/** Outdent a list item one level; at top level it becomes a paragraph. Returns 'li' | 'p'. */
// Outdent keeps document order: siblings AFTER the item move into a nested list under it (they stay visually
// after it). At top level the item becomes a <p> and its own nested lists follow it as top-level lists.
function rtLiOutdent(li) {
  const L = li.parentNode;
  const G = L.parentNode;
  const after = [];
  for (let x = li.nextSibling; x; x = x.nextSibling) after.push(x);
  if (after.some((x) => x.nodeType === 1)) {
    let sub = li.lastElementChild;
    if (!sub || !/^(ul|ol)$/.test(sub.localName)) { sub = document.createElement(L.localName); li.append(sub); }
    sub.append(...after);
  }
  let res = 'li';
  if (G && G.localName === 'li') {
    G.after(li);
  } else {
    const p = document.createElement('p');
    const al = li.style.textAlign;
    if (al) p.style.textAlign = al;
    const nested = [...li.children].filter((c) => /^(ul|ol)$/.test(c.localName));
    for (const n of nested) n.remove();
    p.append(...li.childNodes);
    L.after(p);
    p.after(...nested);
    li.remove();
    res = 'p';
  }
  if (L.isConnected && !L.querySelector('li')) L.remove();
  return res;
}
function rtTopmost(els) {
  return els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
}
function rtIndent(f, range, dir) {
  const leaves = rtLeaves(f, range);
  const lis = rtTopmost(leaves.filter((b) => b.localName === 'li'));
  for (const li of lis) if (li.isConnected) { if (dir > 0) rtLiIndent(li); else rtLiOutdent(li); }
  for (const b of leaves) {
    if (!/^(p|h3|h4)$/.test(b.localName) || !b.isConnected) continue;
    const m = new RegExp('(?:^|\\s)' + P.prefix + '-i([1-4])').exec(b.className);
    const lvl = Math.max(0, Math.min(4, (m ? +m[1] : 0) + (dir > 0 ? 1 : -1)));
    if (lvl) b.className = P.prefix + '-i' + lvl; else b.removeAttribute('class');
  }
}
/** Bullets / numbering toggle (tag 'ul' | 'ol'). */
// All selected blocks already in this list type -> remove the list (outdent repeatedly, bounded by 12 levels);
// otherwise convert paragraphs to items, retag lists of the other type, and merge with adjacent lists of the same
// type so "bullet, paragraph, bullet" -> one list after bulleting the middle paragraph.
function rtToggleList(f, range, tag) {
  const leaves = rtLeaves(f, range);
  if (!leaves.length) return;
  const lis = leaves.filter((b) => b.localName === 'li');
  if (lis.length === leaves.length && lis.every((li) => li.parentNode.localName === tag)) {
    for (const li of rtTopmost(lis)) {
      for (let g = 0; g < 12 && li.isConnected && li.parentNode && /^(ul|ol)$/.test(li.parentNode.localName); g++) {
        if (rtLiOutdent(li) === 'p') break;
      }
    }
    return;
  }
  for (const L of new Set(lis.map((li) => li.parentNode))) if (L.localName !== tag) rtRename(L, tag);
  const blocks = leaves.filter((b) => b.localName !== 'li');
  let group = [];
  const made = [];
  const flush = () => {
    if (!group.length) return;
    const L = document.createElement(tag);
    group[0].before(L);
    for (const b of group) {
      const li = document.createElement('li');
      if (b.style.textAlign) li.style.textAlign = b.style.textAlign;
      li.append(...b.childNodes);
      L.append(li);
      b.remove();
    }
    made.push(L);
    group = [];
  };
  for (const b of blocks) {
    const prev = group[group.length - 1];
    if (prev && prev.nextElementSibling !== b) flush();
    group.push(b);
  }
  flush();
  for (const L of made) { // merge with adjacent lists of the same type
    let host = L;
    const pv = L.previousElementSibling;
    if (pv && pv.localName === tag) { pv.append(...L.childNodes); L.remove(); host = pv; }
    const nx = host.nextElementSibling;
    if (nx && nx.localName === tag) { host.append(...nx.childNodes); nx.remove(); }
  }
}
function rtClearFormat(f, range) {
  for (const n of rtTexts(f, range)) rtStrip(n, f, (a) => RT_FMT_TAGS.has(a.localName));
  if (rtKind(f) !== 'rich') return;
  for (let b of rtLeaves(f, range)) {
    if (/^(h3|h4|pre)$/.test(b.localName)) b = rtRename(b, 'p');
    b.removeAttribute('style');
    if (b.localName !== 'li') b.removeAttribute('class');
  }
}
function rtUnlink(f, range) {
  const a0 = rtUp(range.startContainer, f, (a) => a.localName === 'a');
  if (a0) rtUnwrap(a0);
  for (const a of [...f.querySelectorAll('a')]) if (range.intersectsNode(a)) rtUnwrap(a);
}

// ---------- Command runner (single field or multi-cell table selection) ----------

/**
 * Run an editing op. op(f, range, decided) mutates the DOM of field f inside range.
 * opts.need: 'inline' | 'rich' — minimum field kind; opts.collapsed: behaviour for a collapsed caret:
 *   function(f, range) → handled natively (e.g. execCommand pending style), 'word' → expand to word
 *   (opts.caret(f, range) otherwise), 'block' → expand to the current paragraph; null → run as is.
 * opts.decide(cells) → value passed to op for every cell (keeps toggles consistent across cells).
 */
// Two execution modes. Multi-cell table selection: the op runs on each cell's full content with ONE `decide`d
// value (otherwise toggling bold on cells where some are bold would flip each cell independently), then all cells
// commit as one undo step. Single field: the selection is converted to markers before the op, because the op and
// the subsequent sanitizer pass restructure the DOM and would invalidate a Range; markers survive and restore it.
function rtRun(op, opts = {}) {
  const { need = 'inline', collapsed = null, caret = null, decide = null, multi = true } = opts;
  const cells = multi ? tblMultiCells() : null;
  if (cells) {
    rtFlush();
    const ranges = (c) => { const r = document.createRange(); r.selectNodeContents(c); return r; };
    RT_S.busy = true;
    try {
      for (const c of cells) rtWrapLoose(c);
      const dv = decide ? decide(cells.map((c) => [c, ranges(c)])) : undefined;
      for (const c of cells) {
        op(c, ranges(c), dv);
        const clean = sanitizeHTML(c.innerHTML, 'rich');
        if (clean !== c.innerHTML) c.innerHTML = clean;
      }
    } finally { RT_S.busy = false; }
    const bid = TBL_S.sel.bid;
    const lang = S.lang;
    const vals = cells.map((c) => [c.dataset.f, sanitizeHTML(c.innerHTML, 'rich')]);
    commit(t('rt.h.format'), () => {
      const x = findBlock(bid);
      if (x) for (const [p, v] of vals) setField(x.block, p, lang, v);
    }, { render: 'none' });
    rtSchedUpdate();
    return;
  }
  const f = rtActive();
  if (!f) return;
  const kind = rtKind(f);
  if (kind === 'plain' || (need === 'rich' && kind !== 'rich')) return;
  rtFlush();
  rtRestoreSel(f);
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  if (!f.contains(range.startContainer) || !f.contains(range.endContainer)) return;
  if (range.collapsed && collapsed) {
    if (typeof collapsed === 'function') { collapsed(f, range); rtSchedUpdate(); return; }
    if (collapsed === 'word' && !rtExpandWord(range)) {
      if (caret) { caret(f, range); rtSchedUpdate(); }
      return;
    }
    if (collapsed === 'block') {
      const b = rtUp(range.startContainer, f, (a) => /^(p|h3|h4|pre|li|blockquote)$/.test(a.localName));
      range.selectNodeContents(b || f);
    }
  }
  RT_S.busy = true;
  try {
    rtMark(range);
    rtWrapLoose(f);
    op(f, rtMarkRange(f));
    rtNormalizeEl(f, true);
  } finally { RT_S.busy = false; }
  rtCommitNow(f, t('rt.h.format'));
  rtSchedUpdate();
}

// styleWithCSS=false before every native command: the flag is document-global and another component may have
// changed it; with it on, Chrome writes <span style="font-weight:bold"> instead of tags.
function rtExecNative(cmd, val = null) {
  try { document.execCommand('styleWithCSS', false, false); } catch { /* old engines */ }
  try { return document.execCommand(cmd, false, val); } catch { return false; }
}
function rtQState(cmd) {
  try { return document.queryCommandState(cmd); } catch { return false; }
}

const RT_TOGGLES = {
  bold: ['strong', 'bold'], italic: ['em', 'italic'], underline: ['u', 'underline'], strike: ['s', 'strikeThrough'],
  sup: ['sup', 'superscript'], sub: ['sub', 'subscript'], code: ['code', null],
};
/** Execute a named formatting command (toolbar buttons and shortcuts share this). */
function rtCmd(name, arg) {
  if (RT_TOGGLES[name]) {
    const [tag, native] = RT_TOGGLES[name];
    rtRun((f, r, on) => rtToggleTag(f, r, tag, on), {
      need: 'inline',
      collapsed: native ? () => rtExecNative(native) : 'word',
      decide: (list) => !list.every(([c, r]) => rtAllIn(c, r, tag)),
    });
    return;
  }
  switch (name) {
    case 'block': rtRun((f, r) => rtSetBlock(f, r, arg), { need: 'rich' }); break;
    case 'size': rtStyleCmd('font-size', arg ? arg + 'pt' : ''); break;
    case 'color': if (arg) RT_S.color = arg; rtStyleCmd('color', arg); break;
    case 'hl': if (arg) RT_S.hl = arg; rtStyleCmd('background-color', arg); break;
    case 'align': rtRun((f, r) => rtSetAlign(f, r, arg), { need: 'rich' }); break;
    case 'ul': case 'ol': rtRun((f, r) => rtToggleList(f, r, name), { need: 'rich' }); break;
    case 'indent': rtRun((f, r) => rtIndent(f, r, 1), { need: 'rich' }); break;
    case 'outdent': rtRun((f, r) => rtIndent(f, r, -1), { need: 'rich' }); break;
    case 'clear': rtRun((f, r) => rtClearFormat(f, r), { need: 'inline', collapsed: 'block' }); break;
    case 'unlink': rtRun((f, r) => rtUnlink(f, r), { need: 'inline', multi: false }); break;
    case 'link': rtLinkDialog(); break;
    default: break;
  }
}
function rtStyleCmd(prop, val) {
  rtRun((f, r) => rtSetStyle(f, r, prop, val), {
    need: 'inline', collapsed: 'word', caret: (f, r) => rtStyleCaret(f, r, prop, val),
  });
}
/** Insert plain text at the caret of the active field (special characters). */
function rtInsertText(s) {
  const f = rtActive();
  if (!f) return;
  rtRestoreSel(f);
  if (!rtExecNative('insertText', s)) {
    const r = getSelection().getRangeAt(0);
    r.deleteContents();
    const tx = document.createTextNode(s);
    r.insertNode(tx);
    const c = document.createRange();
    c.setStartAfter(tx);
    rtSetRange(c);
    rtSchedule(f);
  }
}

export {
  RT_TOGGLES,
  rtCmd,
  rtExecNative,
  rtInTag,
  rtIndent,
  rtInsertText,
  rtQState,
  rtRun,
  rtStrip,
  rtTexts,
  rtWrap,
  rtWrapLoose
};
