// readme-editor/preview.js - the rendered README: every top-level block of the source in its own element mapped to
// its source range; images of the document under the remote-image policy (static shields.io badges drawn locally,
// other remote pictures only when the user allows them; relative paths from the project folder); the block toolbar
// (edit, source, up, down, duplicate, delete, insert below); clicks that open the right editor (text and tables in
// place, images and badges in their dialogs, formulas and diagrams in the source dialog, task boxes toggled).
//
// Rendering model: doc.js render() parses S.text into top-level blocks with source offsets; paint() wraps each
// block's HTML in <div class="re-blk" data-i> and replaces the whole preview. Mapping DOM to source is by
// data-i (block) and data-md-pos="start-end" (inline pieces emitted by gfm.js with positions on), so any click
// can be turned into a text range and edited as text. A full repaint per change is affordable because math and
// diagram outputs are cached by source in doc.js; it avoids diffing and the bugs of patching a contenteditable.
// Security: the HTML comes from markdown/gfm.js, which passes raw user HTML through html/sanitize.js (GitHub's
// allowlist) before it reaches this file.
// Privacy policy for images (fixMedia): nothing remote loads unless S.remote is on. Static shields.io badges are
// redrawn locally, other remote images become placeholders, relative paths resolve through the project folder.

import { h, $, $$, lsSet } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { toast } from '../ui/overlays.js';
import { isShields, parseShields, localLabel } from '../badge/shields.js';
import { badgeDataURI } from '../badge/svg.js';
import { S, render, replaceRange, setText } from './doc.js';
import { isRelative, localURL } from './files.js';
import { canEditInPlace, startEdit, commitEdit, cancelEdit } from './edit.js';
import { sourceDialog, mathDialog, imageDialog, parseMedia } from './dialogs.js';
import { badgeDialog } from './badge-dialog.js';
import { openInsertMenu } from './insert.js';

// Hooks default to no-ops so this module works before main.js wires them (and in tests without main.js).
export const P = { el: null, wrap: null, bar: null, notice: null, hover: null, hooks: { select() {}, status() {}, insert() {} } };
let remoteHidden = 0;

const svgURI = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
// Placeholder images as SVG data URIs, sized like the original (clamped) so layout does not jump when the real
// image appears. Text is stripped of & < > (not escaped) because it goes inside SVG markup in a URI.
function placeholder(text, w, h2, missing) {
  const W = Math.min(+w || 220, 600), Hh = Math.min(+h2 || 48, 300);
  const fg = missing ? '#b42318' : '#57606a';
  return svgURI(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><rect x=".5" y=".5" width="${W - 1}" height="${Hh - 1}" rx="6" fill="#8881" stroke="${fg}" stroke-dasharray="4 3"/><text x="${W / 2}" y="${Hh / 2 + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="${fg}">${text.replace(/[&<>]/g, '')}</text></svg>`);
}

// Images and picture sources of rendered HTML under the policy; returns the number of remote images held back.
// Called on an inert template's content, before insertion: changing src there prevents the browser from ever
// requesting the original URL. Doing it after insertion would be too late, the request would already be in flight.
function fixMedia(root) {
  let held = 0;
  // <source srcset> loads by itself: kept only for remote pictures the user allowed (the <img> inside stays).
  for (const s of $$('source[srcset]', root)) {
    const ss = s.getAttribute('srcset');
    if (!(S.remote && ss.split(',').every((p) => /^\s*https?:/i.test(p)))) { s.dataset.srcset = ss; s.removeAttribute('srcset'); }
  }
  for (const im of $$('img', root)) {
    const src = im.getAttribute('src') || '';
    im.dataset.orig = src;
    // Absolute and protocol-relative URLs are remote; data: and blob: fall through untouched (no network).
    if (/^(https?:)?\/\//i.test(src)) {
      if (S.remote) continue;
      if (isShields(src)) {
        const m = parseShields(src);
        const ll = localLabel(m);
        im.src = badgeDataURI({ label: ll.label, message: ll.message, color: m.color, labelColor: m.labelColor, style: m.style });
        im.classList.add('re-local');
        im.title = ll.live ? t('pv.liveBadge') : t('pv.localBadge');
      } else {
        held++;
        im.src = placeholder(t('pv.remoteImg', { host: (/^(?:https?:)?\/\/([^/]+)/i.exec(src) || [])[1] || '' }), im.getAttribute('width'), im.getAttribute('height'));
        im.classList.add('re-held');
      }
    } else if (isRelative(src)) {
      // Relative images: a tiny placeholder now, the blob URL when the async folder lookup resolves.
      im.src = placeholder('…', im.getAttribute('width') || 40, im.getAttribute('height') || 24);
      localURL(src).then((u) => { im.src = u || placeholder(t('pv.missing', { path: src.slice(0, 40) }), im.getAttribute('width'), im.getAttribute('height'), true); if (!u) im.classList.add('re-missing'); });
    }
  }
  return held;
}
// Paints HTML into an element without loading anything first (a template is inert).
// <template>.innerHTML parses without loading images or running scripts (template content is inert), which is
// what lets fixMedia rewrite sources first. replaceChildren moves the fragment in one DOM operation.
export function paintInto(el, html) {
  const tp = document.createElement('template');
  tp.innerHTML = html;
  const held = fixMedia(tp.content);
  el.replaceChildren(tp.content);
  return held;
}

export const blockEl = (i) => P.el.querySelector(`.re-blk[data-i="${i}"]`);

export function paint() {
  // Never repaint during an in-place edit: replacing the DOM would destroy the contenteditable and the caret.
  // The edit session commits first, then the next change repaints.
  if (S.editing) return;
  render();
  const html = S.blocks.map((b, i) => `<div class="re-blk re-t-${b.type}" data-i="${i}">${b.html || ''}</div>`).join('') + (S.footnotes ? `<div class="re-foot">${S.footnotes}</div>` : '');
  // Scroll position kept across the replacement: otherwise each keystroke would jump the preview to the top.
  const top = P.wrap.scrollTop;
  remoteHidden = paintInto(P.el, html);
  P.el.classList.toggle('re-empty', !S.blocks.length);
  // Task checkboxes are rendered disabled (as on GitHub); here they are enabled so a click can toggle the source.
  for (const cb of $$('input.md-task', P.el)) cb.disabled = false;
  if (S.sel >= 0) blockEl(S.sel)?.classList.add('re-sel');
  P.wrap.scrollTop = top;
  P.notice.hidden = !remoteHidden;
  P.notice.querySelector('span').textContent = t('pv.held', { n: remoteHidden });
  hideBar();
  P.hooks.status();
}

export function setRemote(on) { S.remote = !!on; lsSet('re-remote', S.remote); paint(); }

export function selectBlock(i, { scrollSource = true, scrollPreview = false } = {}) {
  for (const x of $$('.re-blk.re-sel', P.el)) x.classList.remove('re-sel');
  S.sel = i;
  const b = S.blocks[i];
  if (!b) return;
  const el = blockEl(i);
  el?.classList.add('re-sel');
  if (scrollPreview) el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (scrollSource) P.hooks.select(b.start, b.end);
  P.hooks.status();
}

// --- block operations -------------------------------------------------------------------------
// Inserts a block at a position (on its own lines, one blank line around); returns the new block's index.
// Inserted text always stands on its own lines with one blank line around it (a Markdown block boundary).
// A position inside a line is moved to that line's end, so a block is never split mid-paragraph.
// After setText re-rendered, the new block is found by its start offset and selected and flashed.
export function insertBlock(text, pos = S.sel >= 0 ? S.blocks[S.sel].end : S.text.length) {
  const v = S.text;
  pos = Math.min(pos, v.length);
  if (pos > 0 && v[pos - 1] !== '\n') { const nl = v.indexOf('\n', pos); pos = nl < 0 ? v.length : nl; }
  const before = v.slice(0, pos), after = v.slice(pos);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const at = pos + pre.length;
  setText(before + pre + text + post + after, [at, at + text.length]);
  const i = S.blocks.findIndex((b) => b.start <= at && at < Math.max(b.end, b.start + 1));
  if (i >= 0) { selectBlock(i, { scrollSource: false, scrollPreview: true }); blockEl(i)?.classList.add('re-flash'); }
  return i;
}
export function deleteBlock(i) {
  // Surrounding newlines are collapsed so deleting a block does not leave a growing gap of blank lines.
  const b = S.blocks[i];
  const before = S.text.slice(0, b.start).replace(/\n+$/, ''), after = S.text.slice(b.end).replace(/^\n+/, '');
  S.sel = -1;
  setText(before + (before && after ? '\n\n' : before ? '\n' : '') + after, [before.length]);
}
export function moveBlock(i, d) {
  // Swap with the neighbour by slicing the text: the separator between the blocks (v.slice(a.end, c.start)) stays.
  const j = i + d, a = S.blocks[Math.min(i, j)], c = S.blocks[Math.max(i, j)];
  if (!a || !c) return;
  const v = S.text, ta = v.slice(a.start, a.end), tc = v.slice(c.start, c.end);
  S.sel = j;
  setText(v.slice(0, a.start) + tc + v.slice(a.end, c.start) + ta + v.slice(c.end), [d < 0 ? a.start : a.start + tc.length + (c.start - a.end)]);
  selectBlock(j, { scrollPreview: true });
}
export function duplicateBlock(i) { const b = S.blocks[i]; insertBlock(S.text.slice(b.start, b.end), b.end); }
export async function editSource(i) {
  const b = S.blocks[i];
  if (!b) return;
  if (S.editing) cancelEdit();
  const kind = b.type === 'diagram' ? 'diagram' : b.type === 'math' ? 'math' : '';
  const v = await sourceDialog(S.text.slice(b.start, b.end), { title: t(kind ? 'dlg.src.' + kind : 'dlg.source'), kind });
  // Block re-read by index after the await: the dialog is modal, so the text cannot change meanwhile, but the block
  // object may have been replaced by a re-render.
  if (v != null) { const bb = S.blocks[i]; replaceRange(bb.start, bb.end, v.replace(/\s+$/, '')); }
}

// --- media --------------------------------------------------------------------------------------
const rangeOf = (el) => { const m = /^(\d+)-(\d+)$/.exec(el?.dataset.mdPos || ''); return m ? [+m[1], +m[2]] : null; };
export async function editMedia(img) {
  // The editable range is the outermost element whose source is exactly this image: a link wrapping only the image
  // (badge with link) or a <picture>; otherwise the <img> itself.
  // The piece of source: a link around only this image, a picture, or the image itself.
  const a = img.closest('a[data-md-pos], picture[data-md-pos]');
  const pic = img.closest('picture');
  let host = img;
  if (a && P.el.contains(a) && (a.tagName === 'PICTURE' || a.querySelectorAll('img').length === 1 && !a.textContent.trim())) host = a;
  else if (pic && rangeOf(pic)) host = pic;
  const r = rangeOf(host) || rangeOf(img);
  if (!r) return;
  if (S.editing) commitEdit();
  const raw = S.text.slice(r[0], r[1]);
  const media = parseMedia(raw);
  const res = isShields(media.src) ? await badgeDialog(media, { existing: true }) : await imageDialog(media, { existing: true });
  if (!res) return;
  replaceRange(r[0], r[1], res.delete ? '' : res.code);
}
async function editInlineMath(el) {
  const r = rangeOf(el);
  if (!r) return;
  const raw = S.text.slice(r[0], r[1]);
  // Three inline math syntaxes are kept: $`...`$ (GitLab/GitHub alternative), $$...$$ inline, and $...$.
  const m = /^\$`([\s\S]*)`\$$/.exec(raw) || /^\$\$([\s\S]*)\$\$$/.exec(raw) || /^\$([\s\S]*)\$$/.exec(raw);
  if (S.editing) commitEdit();
  const tex = await mathDialog(m ? m[1] : raw);
  if (tex == null) return;
  const open = raw.startsWith('$`') ? '$`' : raw.startsWith('$$') ? '$$' : '$', close = open === '$`' ? '`$' : open;
  replaceRange(r[0], r[1], tex ? open + tex + close : '');
}
export function scrollToAnchor(href) {
  let id = decodeURIComponent(href.slice(1));
  // GitHub prefixes heading ids with "user-content-" (clobbering protection); both forms are tried. CSS.escape makes
  // ids with quotes or brackets safe inside the attribute selector.
  const el = P.el.querySelector(`[id="user-content-${CSS.escape(id)}"]`) || P.el.querySelector(`[id="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; }
  toast(t('pv.noAnchor', { id }), 'warn');
  return false;
}

// --- block toolbar ---------------------------------------------------------------------------------
const BAR = [['edit', 'edit'], ['source', 'terminal'], ['up', 'up'], ['down', 'down'], ['dup', 'copy'], ['del', 'trash'], ['add', 'plus']];
// The toolbar is absolutely positioned in the scroll wrapper's coordinate space: block rect minus wrapper rect plus
// scrollTop. 34px above the block, but never above the visible top; clamped horizontally into the wrapper.
function showBar(blk) {
  if (!blk || S.editing) return;
  P.hover = blk;
  const r = blk.getBoundingClientRect(), pr = P.wrap.getBoundingClientRect();
  P.bar.hidden = false;
  P.bar.style.top = Math.max(r.top - pr.top + P.wrap.scrollTop - 34, P.wrap.scrollTop + 4) + 'px';
  P.bar.style.left = Math.max(4, Math.min(r.right - pr.left - P.bar.offsetWidth, pr.width - P.bar.offsetWidth - 12)) + 'px';
}
export function hideBar() { if (P.bar) P.bar.hidden = true; P.hover = null; }

export function mountPreview(wrap) {
  P.wrap = wrap;
  P.notice = h('div', { class: 're-notice', hidden: true }, iconEl('shield'), h('span'), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => setRemote(true) }, t('pv.showRemote')));
  P.el = h('article', { class: 'md-body re-preview', 'aria-label': t('pv.label') });
  P.bar = h('div', { class: 're-blkbar', hidden: true, role: 'toolbar', 'aria-label': t('bar.label') },
    BAR.map(([k, ic]) => h('button', { type: 'button', class: 'ed-iconbtn ed-sm', dataset: { b: k }, title: t('bar.' + k), 'aria-label': t('bar.' + k) }, iconEl(ic))));
  const box = h('div', { class: 're-box' }, h('div', { class: 're-boxhead' }, iconEl('doc'), h('span', { class: 're-boxname' })), P.el);
  wrap.append(P.notice, box, P.bar);

  // Event delegation on the preview root: blocks are recreated on every paint, so per-block listeners would be
  // re-attached constantly. One listener per event type serves any number of blocks.
  P.el.addEventListener('mouseover', (e) => { const b = e.target.closest('.re-blk'); if (b && b !== P.hover) showBar(b); });
  wrap.addEventListener('scroll', () => P.hover && showBar(P.hover), { passive: true });
  P.bar.addEventListener('click', async (e) => {
    const k = e.target.closest('button')?.dataset.b;
    if (!k || !P.hover) return;
    const i = +P.hover.dataset.i;
    if (k === 'edit') { selectBlock(i); if (canEditInPlace(i)) startEdit(i); else editSource(i); }
    else if (k === 'source') editSource(i);
    else if (k === 'up' || k === 'down') moveBlock(i, k === 'up' ? -1 : 1);
    else if (k === 'dup') duplicateBlock(i);
    else if (k === 'del') deleteBlock(i);
    else if (k === 'add') openInsertMenu(e.target.closest('button'), (id) => P.hooks.insert(id, S.blocks[i].end));
  });

  // mousedown, not click, starts an in-place edit: the caret must land where the user pressed, which is only known
  // before the browser processes the click. Media, math, diagrams, task boxes and <summary> have their own click
  // behaviour and are skipped here.
  P.el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('img, .md-math, .md-diagram, input.md-task, summary')) return;
    const blk = e.target.closest('.re-blk');
    if (!blk || (S.editing && S.editing.el === blk)) return;
    if (S.editing) commitEdit();
    const i = +blk.dataset.i;
    selectBlock(i);
    if (canEditInPlace(i)) startEdit(i, e);
  });
  P.el.addEventListener('click', (e) => {
    const cb = e.target.closest('input.md-task');
    if (cb) {
      // Task toggle edits the source: the character between [ ] is flipped (offset from data-md-pos).
      e.preventDefault();
      const r = rangeOf(cb);
      if (r) replaceRange(r[0], r[1], S.text[r[0]] === ' ' ? 'x' : ' ');
      return;
    }
    const img = e.target.closest('img');
    if (img && !S.editing) { e.preventDefault(); editMedia(img); return; }
    const math = e.target.closest('.md-math');
    if (math && !math.closest('.re-editing')) {
      e.preventDefault();
      if (math.classList.contains('md-math-block')) editSource(+math.closest('.re-blk').dataset.i);
      else editInlineMath(math);
      return;
    }
    const dg = e.target.closest('.md-diagram');
    if (dg) { e.preventDefault(); editSource(+dg.closest('.re-blk').dataset.i); return; }
    // Links never navigate inside the editor (a click means "edit"); Ctrl/Cmd+click opens them in a new tab with
    // noopener, so the opened page cannot reach back through window.opener.
    const a = e.target.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      if (href.startsWith('#') && !S.editing) { e.preventDefault(); scrollToAnchor(href); return; }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) window.open(a.href, '_blank', 'noopener');
    }
  });
  P.el.addEventListener('dblclick', (e) => {
    const blk = e.target.closest('.re-blk');
    if (blk && !S.editing && !canEditInPlace(+blk.dataset.i)) editSource(+blk.dataset.i);
  });
}
export const setBoxName = (name) => { const n = $('.re-boxname', P.wrap); if (n) n.textContent = name; };
