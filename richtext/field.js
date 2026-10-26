// richtext/field.js - the active rich field: lookup, selection save / restore with markers, debounced commit to
// the document.
import { S, canvas } from '../studio/state.js';
import { findBlock, getField, setField } from '../studio/doc.js';
import { commit } from '../studio/history.js';
import { RT_S, sanitizeHTML } from './sanitize.js';

//
// Field contract with the editor canvas: an editable field is an element with data-f="<path>" (the field path in
// the block), data-kind="rich" | "inline" | "plain", contenteditable, inside a block [data-bid]. The DOM is the
// working copy while typing; the document model is updated by debounced commits of sanitized innerHTML.
// ---------- Field helpers, selection markers, commit ----------

function rtKind(f) {
  return (f && f.dataset && f.dataset.kind) || 'plain';
}
/** The editable field ([data-f], contenteditable, inside the canvas) containing node, or null. */
// canvas.contains guard: a [data-f] element elsewhere (a dialog preview, the toolbar) is never treated as a field.
function rtFieldOf(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const f = el && el.closest ? el.closest('[data-f]') : null;
  return f && f.isContentEditable && canvas.contains(f) ? f : null;
}
function rtBid(f) {
  const b = f && f.closest('[data-bid]');
  return b ? b.dataset.bid : null;
}
function rtActive() {
  const f = RT_S.field;
  return f && f.isConnected && f.isContentEditable ? f : null;
}
/** Focus lands on editor chrome that must not end the current field context. */
// Focus moving into the toolbar, a popover or an overlay must not end the field context (blur would otherwise
// drop the saved selection that a toolbar command is about to act on).
function rtIsUI(el) {
  return !!(el && el.closest && el.closest('#ed-format, .rt-pop, #ed-overlays'));
}
// Tiny DOM builder for the richtext UI. The 'html' key sets innerHTML: callers pass only trusted static markup
// (icon SVG strings); user text goes through 'text' or child nodes.
function rtEl(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
}
// Shortcut labels: userAgentData.platform where available (navigator.platform is deprecated), UA fallback.
function rtMac() {
  const n = typeof navigator !== 'undefined' ? navigator : null;
  return /Mac|iPhone|iPad|iPod/.test((n && ((n.userAgentData && n.userAgentData.platform) || n.platform || n.userAgent)) || '');
}
function rtKey(k, shift = false) {
  return rtMac() ? (shift ? '⇧' : '') + '⌘' + k : 'Ctrl+' + (shift ? 'Shift+' : '') + k;
}
function rtUp(node, f, pred) {
  for (let a = node && (node.nodeType === 1 ? node : node.parentNode); a && a !== f; a = a.parentNode) {
    if (a.nodeType === 1 && pred(a)) return a;
  }
  return null;
}
function rtUnwrap(el) {
  if (el.parentNode) el.replaceWith(...el.childNodes);
}
// Every programmatic selection change also stores a CLONE in RT_S.range: live Range objects returned by the
// selection are mutated by the browser as the selection moves, a clone is a stable snapshot to restore later.
function rtSetRange(r) {
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  RT_S.range = r.cloneRange();
}
function rtCaretEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  rtSetRange(r);
}
/** Focus field f and put back the last known selection inside it (lost to a toolbar select / dialog). */
// Toolbar <select>s and dialogs steal focus and collapse the field's selection; commands call this first to put
// the user's selection back. preventScroll: refocusing must not jump the page.
function rtRestoreSel(f) {
  const sel = getSelection();
  const cur = sel.rangeCount ? sel.getRangeAt(0) : null;
  // the live selection wins when it is inside f (selectionchange may not have fired yet)
  const r = cur && f.contains(cur.startContainer) && f.contains(cur.endContainer) ? cur.cloneRange() : RT_S.range;
  if (document.activeElement !== f) f.focus({ preventScroll: true });
  if (r && f.contains(r.startContainer) && f.contains(r.endContainer)) rtSetRange(r);
  else rtCaretEnd(f);
}
function rtCurRange(f) {
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (f.contains(r.startContainer) && f.contains(r.endContainer)) return r;
  }
  const s = RT_S.range;
  return s && f.contains(s.startContainer) && f.contains(s.endContainer) ? s : null;
}

/** Insert selection markers (they survive DOM moves and re-serialization through the sanitizer). */
// Selection markers: empty <span data-rt-mark="s|e"> elements inserted at the range boundaries. Unlike Range
// offsets, elements survive innerHTML re-serialization and DOM restructuring (sanitizer pass, list rebuild), so the
// selection can be restored afterwards. End marker first: inserting at the start would shift the end offset when
// both boundaries are in the same text node.
function rtMark(range) {
  const mk = (k) => { const s = document.createElement('span'); s.setAttribute('data-rt-mark', k); return s; };
  if (!range.collapsed) {
    const r = range.cloneRange();
    r.collapse(false);
    r.insertNode(mk('e'));
  }
  const r = range.cloneRange();
  r.collapse(true);
  r.insertNode(mk('s'));
}
function rtMarkRange(f) {
  const s = f.querySelector('[data-rt-mark="s"]');
  const e = f.querySelector('[data-rt-mark="e"]');
  const r = document.createRange();
  if (s) r.setStartAfter(s); else r.setStart(f, 0);
  if (e) r.setEndBefore(e); else r.collapse(true);
  return r;
}
function rtLen(n) {
  return n.nodeType === 3 ? n.length : n.childNodes.length;
}
/** Remove a marker; returns the [node, offset] where it was, merging the text nodes around it. */
// Removing a marker splits nothing but leaves two adjacent text nodes; they are merged and the caret position
// is returned as (text node, offset) so the restored caret lands inside text, not between nodes (browsers render
// a caret between nodes inconsistently).
function rtDropMark(m) {
  const p = m.parentNode;
  const prev = m.previousSibling;
  const next = m.nextSibling;
  m.remove();
  if (prev && prev.nodeType === 3) {
    const off = prev.length;
    if (next && next.nodeType === 3) { prev.appendData(next.data); next.remove(); }
    return [prev, off];
  }
  if (next && next.nodeType === 3) return [next, 0];
  return [p, prev ? Array.prototype.indexOf.call(p.childNodes, prev) + 1 : 0];
}
function rtUnmark(f, doSelect = true) {
  const s = f.querySelector('[data-rt-mark="s"]');
  const sp = s ? rtDropMark(s) : null;
  const e = f.querySelector('[data-rt-mark="e"]');
  const ep = e ? rtDropMark(e) : null;
  for (const m of f.querySelectorAll('[data-rt-mark]')) m.remove();
  if (!doSelect) return;
  const r = document.createRange();
  if (sp && sp[0].isConnected && f.contains(sp[0])) {
    r.setStart(sp[0], Math.min(sp[1], rtLen(sp[0])));
    if (ep && ep[0].isConnected && f.contains(ep[0])) r.setEnd(ep[0], Math.min(ep[1], rtLen(ep[0])));
    else r.collapse(true);
  } else { r.selectNodeContents(f); r.collapse(false); }
  rtSetRange(r);
}

/** Re-serialize a field through the sanitizer, keeping the selection (via markers) when asked. */
// Re-sanitize the live field in place. innerHTML is rewritten only when the sanitized form differs: an assignment
// would destroy the selection and undo stack of contenteditable even when nothing changed.
function rtNormalizeEl(f, keepSel) {
  if (!f || !f.isConnected) return;
  const kind = rtKind(f);
  if (kind === 'plain') {
    if (f.firstElementChild) {
      f.textContent = sanitizeHTML(f.innerHTML, 'plain');
      if (keepSel && document.activeElement === f) rtCaretEnd(f);
    }
    return;
  }
  let marked = !!f.querySelector('[data-rt-mark]');
  if (!marked && keepSel) {
    const r = rtCurRange(f);
    if (r) { rtMark(r); marked = true; }
  }
  const cur = f.innerHTML;
  const clean = sanitizeHTML(cur, kind, { marks: marked });
  if (clean !== cur) f.innerHTML = clean;
  if (marked) rtUnmark(f, keepSel);
}

/** Schedule a debounced, coalesced commit of the field's content. */
// Debounce (350 ms) with coalescing: consecutive keystrokes in one field form one pending commit; switching to
// another field flushes the previous one first so edits are never attributed to the wrong field. The block id and
// field path are captured at schedule time: the DOM may be re-rendered before the timer fires.
function rtSchedule(f) {
  const p = RT_S.pend;
  if (p && p.f !== f) rtFlush();
  if (!RT_S.pend) RT_S.pend = { f, bid: rtBid(f), path: f.dataset.f, lang: S.lang, kind: rtKind(f), timer: 0 };
  clearTimeout(RT_S.pend.timer);
  RT_S.pend.timer = setTimeout(rtFlush, 350);
}
/** Commit any pending (debounced) field edit immediately. Called by the editor (studio/) before undo / save / export / render. */
function rtFlush() {
  const p = RT_S.pend;
  if (!p) return;
  RT_S.pend = null;
  clearTimeout(p.timer);
  rtCommitVal(p.bid, p.path, p.lang, sanitizeHTML(p.f.innerHTML, p.kind), 'type', true);
}
// No-op when the value is unchanged (no empty undo steps). `coalesce` key merges a typing burst into one history
// entry; render:'none' because the DOM already shows the new content (re-rendering would reset the caret).
// The block is looked up again inside the commit callback: history replays it later against the current model.
function rtCommitVal(bid, path, lang, val, label, coalesce) {
  if (!bid || !path) return false;
  const fb = findBlock(bid);
  if (!fb) return false;
  if ((getField(fb.block, path, lang) || '') === val) return false;
  const opts = { render: 'none' };
  if (coalesce) opts.coalesce = `field:${bid}:${path}:${lang}`;
  commit(label, () => {
    const x = findBlock(bid);
    if (x) setField(x.block, path, lang, val);
  }, opts);
  return true;
}
/** Commit field f now as its own undo step (formatting, paste, link). */
function rtCommitNow(f, label) {
  if (RT_S.pend && RT_S.pend.f === f) { clearTimeout(RT_S.pend.timer); RT_S.pend = null; } else rtFlush();
  rtCommitVal(rtBid(f), f.dataset.f, S.lang, sanitizeHTML(f.innerHTML, rtKind(f)), label, false);
}

export {
  rtActive,
  rtBid,
  rtCaretEnd,
  rtCommitNow,
  rtCurRange,
  rtEl,
  rtFieldOf,
  rtFlush,
  rtIsUI,
  rtKey,
  rtKind,
  rtMark,
  rtMarkRange,
  rtNormalizeEl,
  rtRestoreSel,
  rtSchedule,
  rtSetRange,
  rtUnwrap,
  rtUp
};
