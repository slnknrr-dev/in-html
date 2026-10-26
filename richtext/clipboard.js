// richtext/clipboard.js - copy and paste in rich fields and table cell selections (sanitized HTML, plain text).
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { RT_FMT_TAGS, RT_S, RT_ZW, rtEsc, rtIsBlockNode, sanitizeHTML } from './sanitize.js';
import { rtCommitNow, rtFieldOf, rtFlush, rtKind, rtNormalizeEl, rtSchedule, rtSetRange, rtUp } from './field.js';
import { rtExecNative, rtInsertText, rtWrapLoose } from './ops.js';
import { rtSchedUpdate } from './toolbar.js';
import { P } from '../doc/product.js';

//
// Paste is always intercepted (preventDefault) and re-inserted from sanitized HTML: the browser's native paste
// would insert the source document's markup and inline styles verbatim, and contenteditable has no hook to filter
// it afterwards without losing the caret. Every inserted string has passed sanitizeHTML or rtEsc.
// ---------- Paste / copy / insertion ----------

/** Plain text → HTML for a field kind (paragraphs on blank lines, bullet lines → lists). */
// Plain-text fallback with light structure recognition: blank lines -> paragraphs, a block where EVERY line starts
// with a bullet or "1." -> a list (requiring all lines avoids turning one dash-prefixed sentence into a list).
function rtTextToHTML(text, kind) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(RT_ZW, '');
  if (kind === 'inline') return rtEsc(text.trim()).replace(/\n/g, '<br>');
  if (!text.trim()) return '';
  if (!text.trim().includes('\n')) return rtEsc(text);
  const bullet = /^\s*([-*•·▪◦‣–]|\d{1,3}[.)])\s+/;
  const out = [];
  for (const para of text.split(/\n[ \t]*\n/)) {
    const lines = para.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.length > 1 && lines.every((l) => bullet.test(l))) {
      const tag = /^\s*\d/.test(lines[0]) ? 'ol' : 'ul';
      out.push(`<${tag}>${lines.map((l) => '<li>' + rtEsc(l.replace(bullet, '').trim()) + '</li>').join('')}</${tag}>`);
    } else out.push('<p>' + lines.map((l) => rtEsc(l.trim())).join('<br>') + '</p>');
  }
  return out.join('');
}
// getData can throw for unsupported types in some browsers (and in Firefox for custom types): treat as absent.
function rtGetData(cd, type) {
  try { return cd.getData(type) || ''; } catch { return ''; }
}
/** Convert top-level pasted blocks so they can live inside a list. */
function rtToLis(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.nodeType === 1 && /^(ul|ol)$/.test(n.localName)) { out.push(...[...n.children].filter((c) => c.localName === 'li')); continue; }
    if (n.nodeType === 1 && n.localName === 'li') { out.push(n); continue; }
    if (n.nodeType === 1 && n.localName === 'hr') continue;
    const li = document.createElement('li');
    if (n.nodeType === 1 && rtIsBlockNode(n)) li.append(...n.childNodes); else li.append(n);
    out.push(li);
  }
  return out;
}
/** Insert sanitized HTML at the caret of field f (splitting the current paragraph for block content). */
// Inline-only content is inserted at the caret as is. Block content splits the current block at a temporary
// marker: the part after the caret (tail) is extracted, the first pasted paragraph merges into the current block
// (so pasting "a\n\nb" mid-sentence continues the line like word processors do), remaining blocks follow, and the
// tail is re-attached to the last block or to a clone of the original block. Inside a list, pasted blocks are
// converted to <li> so the list structure stays valid.
// The non-collapsed selection is deleted via the native command first: it merges partially selected blocks
// correctly, which Range.deleteContents does not (it leaves two half-empty blocks).
function rtInsertHTML(f, html) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  if (!sel.getRangeAt(0).collapsed) rtExecNative('delete'); // native delete merges partially selected blocks
  const range = sel.getRangeAt(0).cloneRange();
  if (!f.contains(range.startContainer)) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.childNodes];
  if (!nodes.length) return;
  const caret = document.createRange();
  if (!nodes.some(rtIsBlockNode)) {
    const last = nodes[nodes.length - 1];
    range.insertNode(tpl.content);
    caret.setStartAfter(last);
    caret.collapse(true);
    rtSetRange(caret);
    return;
  }
  const mk = document.createElement('span');
  mk.setAttribute('data-rt-ins', '');
  range.insertNode(mk);
  rtWrapLoose(f);
  const blk = rtUp(mk, f, (a) => /^(p|h3|h4|pre|li)$/.test(a.localName) ||
    (a.localName === 'blockquote' && ![...a.children].some(rtIsBlockNode)));
  if (!blk) {
    mk.replaceWith(...nodes);
    const last = nodes[nodes.length - 1];
    caret.selectNodeContents(last);
    caret.collapse(false);
    rtSetRange(caret);
    return;
  }
  const r2 = document.createRange();
  r2.setStartAfter(mk);
  r2.setEnd(blk, blk.childNodes.length);
  const tail = r2.extractContents();
  mk.remove();
  const isLi = blk.localName === 'li';
  const blocks = isLi ? rtToLis(nodes) : nodes.filter((n) => n.nodeType === 1 || /\S/.test(n.data));
  // the first pasted paragraph continues the current one
  const first = blocks[0];
  if (first && first.nodeType === 1 && first.localName === (isLi ? 'li' : 'p') && !(isLi && first.querySelector('ul,ol'))) {
    blk.append(...first.childNodes);
    blocks.shift();
  }
  let last = blk;
  for (const b of blocks) {
    if (b.nodeType !== 1) continue;
    last.after(b);
    last = b;
  }
  const tailHas = tail.textContent.replace(RT_ZW, '') !== '';
  if (last === blk || /^(p|li|h3|h4|pre)$/.test(last.localName)) {
    caret.setStart(last, last.childNodes.length);
    if (tailHas) last.append(tail);
  } else if (!tailHas) { // ends with a list/quote/rule: caret at the end of its last text block, no extra paragraph
    const lb = [...last.querySelectorAll('li,p,h3,h4,pre')].pop();
    if (lb) caret.setStart(lb, lb.childNodes.length); else caret.setStartAfter(last);
  } else {
    const b2 = blk.cloneNode(false);
    b2.append(tail);
    last.after(b2);
    caret.setStart(b2, 0);
  }
  caret.collapse(true);
  if (!blk.textContent && !blk.querySelector('br,hr') && blk !== last) blk.remove();
  rtSetRange(caret);
}
// Source priority: the editor's own private clipboard type (exact formatting, sanitized without paste stripping,
// works between fields and tabs of the same browser), then text/html (sanitized with paste stripping: foreign
// colours/sizes removed), then text/plain. RT_S.busy suppresses the input/selection handlers while the DOM is
// rewritten, so they do not schedule commits of intermediate states; one explicit commit follows.
function rtOnPaste(e) {
  const f = rtFieldOf(e.target);
  if (!f || !e.clipboardData) return;
  const cd = e.clipboardData;
  const kind = rtKind(f);
  e.preventDefault();
  rtFlush();
  const own = rtGetData(cd, 'application/x-' + P.prefix + '-html');
  const html = own || rtGetData(cd, 'text/html');
  const text = rtGetData(cd, 'text/plain');
  if (!html && !text) {
    if (cd.files && cd.files.length) toast(t('rt.pasteFiles'), 'info');
    return;
  }
  if (kind === 'plain') {
    const s = (text || sanitizeHTML(html, 'plain')).replace(/\s+/g, ' ').trim();
    if (s) rtInsertText(s);
    return;
  }
  let clean = html ? sanitizeHTML(html, kind, { paste: !own }) : '';
  if (!clean && text) clean = rtTextToHTML(text, kind);
  if (!clean) return;
  RT_S.busy = true;
  try {
    rtInsertHTML(f, clean);
    rtNormalizeEl(f, true);
  } finally { RT_S.busy = false; }
  rtCommitNow(f, t('rt.h.paste'));
  rtSchedUpdate();
}
/** Copy from a rich/inline field: clean HTML (+ private type so pasting back keeps sizes/colours). */
// cloneContents() of a selection inside <strong>..</strong> returns only the text: the formatting ancestors are
// outside the range. They are re-created around the fragment (up to the enclosing block) so the copy keeps bold,
// links, colours. Three flavours are written: html, plain text, and the private type for lossless round-trips.
function rtOnCopy(e, cut = false) {
  const sel = getSelection();
  if (!sel.rangeCount || !e.clipboardData) return;
  const r = sel.getRangeAt(0);
  const f = rtFieldOf(r.commonAncestorContainer);
  if (!f || r.collapsed || rtKind(f) === 'plain') return;
  let node = r.cloneContents();
  for (let a = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    a && a !== f && !rtIsBlockNode(a); a = a.parentNode) {
    if (!RT_FMT_TAGS.has(a.localName) && a.localName !== 'a') continue;
    const c = a.cloneNode(false);
    c.append(node);
    node = c;
  }
  const box = document.createElement('div');
  box.append(node);
  const html = sanitizeHTML(box.innerHTML, rtKind(f));
  try {
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', sel.toString());
    e.clipboardData.setData('application/x-' + P.prefix + '-html', html);
  } catch { return; }
  e.preventDefault();
  if (cut) { rtExecNative('delete'); rtSchedule(f); }
}

export {
  rtOnCopy,
  rtOnPaste
};
