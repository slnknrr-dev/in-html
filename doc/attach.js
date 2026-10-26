// doc/attach.js - attachments: preview policy, sources, file info. Attachment data lives in doc.attachments[id].data
// (standard base64) or, in the editor, behind ctx.attURL(id) (blob URLs).
//
// Security model: attachments are untrusted user files. Anything that can run script (HTML, SVG, XML, JS) is never
// shown through <object>/<img> of the page origin; it goes into an <iframe sandbox=""> (no scripts, opaque origin).
// MIME checks run on the base type (parameters stripped, lower-cased) so "Text/HTML; charset=x" cannot slip through.
// Every id reaching markup passes escapeAttr; data URIs are built only from data that passed isB64 + MIME_RE, so
// neither the MIME nor the payload can close the attribute.
import { isB64 } from '../codec/base64.js';
import { intl, intlSupports } from '../i18n/intl.js';
import { escapeAttr } from '../html/escape.js';
import { MIME_RE, isObj, own, round, str } from '../util/value.js';
import { ICONS, P } from './product.js';

const IMG_MIME = /^image\/(png|jpe?g|pjpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;
export const isImage = (a) => isObj(a) && IMG_MIME.test(str(a.mime));
// Inline preview policy for non-image attachments (shared with the editor and mirrored in the runtime).
const PREVIEW_OBJ = /^(application\/pdf|text\/plain|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm))$/;
// Deliberately unanchored substring match: catches application/xhtml+xml, image/svg+xml, text/x-javascript, ...
// A false positive only downgrades a preview to the sandbox; a false negative would be script on our origin.
const ACTIVE_MIME = /html|xml|svg|javascript|ecmascript/i;
// Formats a native <video>/<audio controls> player can show.
export const MEDIA_MIME = /^(video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm))$/;
export const mimeBase = (mime) => str(mime).split(';')[0].trim().toLowerCase();

// 'frame' -> sandboxed <iframe sandbox=""> (active content), 'object' -> <object> preview, '' -> no inline preview.
// ACTIVE_MIME is tested first: svg is an image type but must still land in the sandbox, never in <object>.
export function previewKind(mime) {
  const m = mimeBase(mime);
  if (!m) return '';
  if (ACTIVE_MIME.test(m)) return 'frame';
  return PREVIEW_OBJ.test(m) ? 'object' : '';
}

// <object data> for an inline preview: PDFs open fitted to the width without the viewer's toolbar / side panel (a bare
// blob URL shows Chromium's dark chrome and no visible page at preview size). Open / download URLs never get this.
const PDF_VIEW = '#toolbar=0&navpanes=0&view=FitH';
export const previewData = (u, mime) => (u && mimeBase(mime) === 'application/pdf' ? u + PDF_VIEW : u);

// Icon name for an attachment kind (falls back to 'file' when the product has no such icon).
export function kindIcon(a) {
  const m = mimeBase(a && a.mime);
  const k = isImage(a) ? 'image' : m === 'application/pdf' ? 'pdf' : /^video\//.test(m) ? 'video' : /^audio\//.test(m) ? 'music' : 'file';
  return k === 'file' || typeof own(ICONS, k) === 'string' ? k : 'file';
}

export const attOf = (ctx, id) => {
  const a = typeof id === 'string' ? own(ctx.doc.attachments, id) : null;
  return isObj(a) ? a : null;
};

// Image source: edit -> the editor's blob URL; view -> data: URI (records the inline copy for the size report, the
// store exclusion and the "already shown above" dedup; previews in P.previewTypes blocks are not the first copy), or
// the file's relative URL when the export keeps attachments as files (ctx.assetURL).
// Side effects are intentional: the render pass doubles as the usage scan that export.js uses to decide which data to
// write (ctx.use.*). hasData() below is the side-effect-free twin; keep their conditions in sync.
export function attSrc(ctx, a) {
  if (ctx.edit && ctx.attURL) {
    const u = ctx.attURL(a.id);
    if (u) return u;
  }
  ctx.use.atts.add(a.id);
  // Exports with attachments as separate files (ctx.assetURL, archives): a relative URL instead of the data.
  const file = !ctx.edit && ctx.assetURL && MIME_RE.test(str(a.mime)) ? str(ctx.assetURL(a)) : '';
  if (file) {
    if (ctx.curBlock && ctx.curUncond && !(P.previewTypes || []).includes(ctx.curType) && !ctx.imgFirst.has(a.id)) {
      ctx.imgFirst.set(a.id, ctx.curBlock);
    }
    return file;
  }
  if (isB64(a.data) && MIME_RE.test(str(a.mime))) {
    if (!ctx.edit) {
      const n = ctx.use.imgInlineCount;
      ctx.use.imgInline.add(a.id);
      n.set(a.id, (n.get(a.id) || 0) + 1);
      if (ctx.curBlock && ctx.curUncond && !(P.previewTypes || []).includes(ctx.curType) && !ctx.imgFirst.has(a.id)) {
        ctx.imgFirst.set(a.id, ctx.curBlock);
      }
    }
    return `data:${a.mime};base64,${a.data}`;
  }
  return (ctx.attURL && ctx.attURL(a.id)) || '';
}

// Whether attSrc() will produce a source for the attachment (same conditions, without recording usage).
export const hasData = (ctx, a) => (isB64(a.data) && MIME_RE.test(str(a.mime))) || !!(ctx.attURL && ctx.attURL(a.id));

export const imgAttr = (ctx, a) => (ctx.edit ? '' : ` data-att-img="${escapeAttr(a.id)}"`);

// ` id="att-<id>"` on the block that carries the #att-<id> link target of this attachment (view mode).
export const attAnchorAttr = (ctx, b, a) => (!ctx.edit && a && b && ctx.attAnchor.get(a.id) === b.id ? ` id="att-${escapeAttr(a.id)}"` : '');

// Binary multiples (1024) with SI-looking labels, as file managers do. Intl unit style localises the number and the
// unit name; the throw jumps to the neutral form when ICU lacks the locale (see i18n/intl.js intlSupports).
export function formatSize(bytes, lang) {
  const n = Number(bytes) || 0;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  try {
    if (!intlSupports('NumberFormat', lang)) throw new Error('no locale data'); // neutral "1.2 MB" below
    return intl('NumberFormat', lang, { style: 'unit', unit: units[i], unitDisplay: i ? 'short' : 'narrow',
      maximumFractionDigits: i ? 1 : 0 }).format(v);
  } catch (e) {
    return round(v, 1) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
  }
}

// Badge text: the file extension is what users recognise; MIME subtype ('vnd.ms-excel' -> 'VND') is a last resort.
export function fileTypeLabel(att) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(att.name || '');
  if (m) return m[1].toUpperCase();
  const sub = String(att.mime || '').split('/')[1] || 'file';
  return sub.replace(/^x-/, '').split(/[+.;]/)[0].toUpperCase();
}
