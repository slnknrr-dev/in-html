// paper/attach.js - attachment cards of paper documents (attachment blocks and appendix items): title, file info,
// action buttons, inline preview.
//
// Contract: pure string renderers over ctx (doc/render.js render context). Every interpolated value passes through
// escapeHTML / escapeAttr or a doc/render.js helper that escapes; attachment names and MIME types are user data
// (uploaded files) and are the main injection vector of an exported page.
//
// Security model of previews (the reason this file exists rather than a plain <iframe src>):
// - Exports are single HTML files; attachments are embedded and served as blob: URLs, which inherit the page's
//   origin. A blob HTML/SVG opened as a document would run script with full access to the export.
// - Therefore: active formats (html/xml/svg/js) only in <iframe sandbox=""> (opaque origin, scripts off); a small
//   allowlist of passive formats (pdf, text, audio, video) in <object>; anything else gets a fallback card.
//   previewKind() (doc/attach.js) decides; the runtime (paper/runtime.js rtAttach) re-checks before hydrating, so a
//   tampered export cannot upgrade an element.
// - View mode never sets src/data at render time: elements carry data-att and are hydrated lazily (rtAttach), which
//   keeps the initial parse cheap when a document embeds many large files.
//
// ctx.use is the usage collector: whatever a render touches (blob, atts, zoom, xrefs) decides which runtime features and
// CSS chunks the exporter ships (tree shaking by observed use, not by configuration).
import { P } from '../doc/product.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { uiText } from '../doc/dict.js';
import { num } from '../util/value.js';
import { altAttr, breakable, fld, grp, has, icon, plainIn, plainOf, txt, ui } from '../doc/render.js';
import { attSrc, fileTypeLabel, formatSize, imgAttr, isImage, kindIcon, mimeBase, previewData, previewKind } from '../doc/attach.js';

/* ---------- attachments ---------- */

// Editor-only placeholder for a block whose attachment was deleted; view mode renders nothing instead (blocks.js).
function missingBox(ctx, ic) {
  return `<div class="${P.prefix}-att-missing">${icon(ctx, ic || 'image')}<span>${escapeHTML(uiText('edit.noAtt', ctx.uiLang, ctx.doc))}</span></div>`;
}

// Download / print / open buttons. Rendered as real <button type="button"> (keyboard + AT for free), wired by
// delegation in rtAttach via data-att-dl/pr/op, so no per-button script and no inline handlers (CSP-friendly).
// The usage marks are view-only: the editor has its own file actions and must not pull the runtime into its preview.
function attButtons(ctx, a, o) {
  let s = '';
  const btn = (k, ic, key) => `<button type="button" class="${P.prefix}-btn" data-att-${k} data-att="${escapeAttr(a.id)}">${icon(ctx, ic)}<span>${ui(ctx, key)}</span></button>`;
  if (o.dl) s += btn('dl', 'download', 'download');
  if (o.pr) s += btn('pr', 'print', 'print');
  if (o.op) s += btn('op', 'open', 'open');
  if (!s) return '';
  if (!ctx.edit) { ctx.use.blob.add(a.id); ctx.use.atts.add(a.id); }
  return `<div class="${P.prefix}-att-btns ${P.prefix}-noprint">${s}</div>`;
}

// Shared by attachment blocks and appendix items: header line (+ buttons) + optional preview.
function attInner(ctx, a, o) {
  // Editing: the caption is an inline editable field with the file name as placeholder; view: caption, else title, else name.
  let title;
  if (o.blk && ctx.edit) {
    title = fld(ctx, o.blk, 'caption', 'plain', 'div', `${P.prefix}-att-title`, null, { ph: plainOf(ctx, a.title) || a.name });
  } else {
    const src = o.blk && has(ctx, o.blk.caption) ? o.blk.caption : has(ctx, a.title) ? a.title : null;
    title = `<div class="${P.prefix}-att-title">${src ? txt(ctx, src) : breakable(a.name)}</div>`;
  }
  const desc = o.desc && has(ctx, a.desc) ? `<div class="${P.prefix}-att-desc">${txt(ctx, a.desc)}</div>` : '';
  // breakable() inserts break opportunities into long file names (no spaces to wrap at) so they cannot overflow the card.
  const info = `<div class="${P.prefix}-att-info">${breakable(a.name)} ·${escapeHTML(fileTypeLabel(a))} · `
    + `${grp(ctx, (l) => escapeHTML(formatSize(a.size, l)))}</div>`;
  const btns = attButtons(ctx, a, o);
  let prev = '';
  if (o.ref) {
    // The image is already shown inline in the document: link to it instead of embedding another copy.
    const href = '#b-' + o.ref;
    ctx.use.xrefs.add(href);
    prev = `<div class="${P.prefix}-att-prev ${P.prefix}-att-see ${P.prefix}-noprint"><a class="${P.prefix}-xref" href="${escapeAttr(href)}">${icon(ctx, 'image')}<span>${ui(ctx, 'shownAbove')}</span></a></div>`;
  } else if (o.embed) {
    if (isImage(a)) {
      const src = attSrc(ctx, a);
      if (src) {
        const alt = altAttr(ctx, (l) => (o.blk && plainIn(ctx, o.blk.caption, l)) || plainIn(ctx, a.title, l) || a.name);
        // View mode: the preview opens in the lightbox (rtAttach) — keyboard reachable and announced as a button.
        let zoom = '';
        if (!ctx.edit) { ctx.use.zoom = true; zoom = ' tabindex="0" role="button" aria-haspopup="dialog"'; }
        prev = `<div class="${P.prefix}-att-prev ${P.prefix}-att-img"><img src="${escapeAttr(src)}"${alt}${imgAttr(ctx, a)}${zoom}></div>`;
      }
    } else {
      // Preview height in mm, clamped to the schema range (40-260); a hostile document cannot request a 10 m tall frame.
      const h = num(o.height, 120, 40, 260);
      // Active formats (html/xml/svg/js) → sandboxed iframe (opaque origin, no scripts); a small allowlist of
      // passive formats → <object>; anything else → fallback card only (never a same-origin blob document).
      const kind = previewKind(a.mime);
      const type = mimeBase(a.mime);
      const fb = `<div class="${P.prefix}-att-fb">${icon(ctx, kindIcon(a))}<span>${ui(ctx, 'noPreview')}</span></div>`;
      let el = '';
      if (!kind) {
        el = fb;
      // Editor: the studio supplies an object URL directly (ctx.attURL). tabindex="-1" keeps the preview out of the
      // canvas's tab order so keyboard editing does not get trapped inside a PDF viewer.
      } else if (ctx.edit) {
        const u = ctx.attURL && ctx.attURL(a.id);
        if (u) {
          el = kind === 'frame'
            ? `<iframe class="${P.prefix}-att-obj" sandbox="" src="${escapeAttr(u)}" title="${escapeAttr(a.name)}" tabindex="-1" style="height:${h}mm"></iframe>`
            : `<object class="${P.prefix}-att-obj" data="${escapeAttr(previewData(u, type))}" type="${escapeAttr(type)}" tabindex="-1" style="height:${h}mm">${fb}</object>`;
        } else el = fb;
      } else {
        ctx.use.blob.add(a.id);
        ctx.use.atts.add(a.id);
        el = kind === 'frame'
          ? `<iframe class="${P.prefix}-att-obj" sandbox="" data-att="${escapeAttr(a.id)}" title="${escapeAttr(a.name)}" style="height:${h}mm"></iframe>`
          : `<object class="${P.prefix}-att-obj" data-att="${escapeAttr(a.id)}" type="${escapeAttr(type)}" style="height:${h}mm" aria-label="${escapeAttr(a.name)}">${fb}</object>`;
      }
      prev = `<div class="${P.prefix}-att-prev">${el}</div>`;
    }
  }
  return `<div class="${P.prefix}-att-head">${icon(ctx, kindIcon(a), `${P.prefix}-att-ic`)}<div class="${P.prefix}-att-meta">${title}${desc}${info}</div>${btns}</div>${prev}`;
}

export {
  attInner,
  missingBox
};
