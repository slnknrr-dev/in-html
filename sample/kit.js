// sample/kit.js - template building kit shared by the products: localized values, blocks and sample attachments.
import { tplB64Size, tplUtf8 } from './bytes.js';
import { tplMakePDF } from './pdf.js';
import { tplAvatarSVG, tplImageSVG } from './svg.js';
import { tplImagePNG } from './png.js';
import { b64encode } from '../codec/base64.js';

/** First icon key that exists in V.ICONS, else '' (icons are optional decoration). */
function tplIcon(V, ...names) {
  const icons = V && V.ICONS;
  if (!icons) return '';
  for (const n of names) if (n && Object.prototype.hasOwnProperty.call(icons, n)) return n;
  return '';
}

/**
 * Sample file generators and the attachment factory used by templates:
 * files.attachment({ id?, name, mime, data, title, desc, asset }) -> attachment.
 * o.pdf: default tplMakePDF options; o.extra(src) -> product fields of an attachment (placed before `asset`).
 */
function tplSampleFiles(V, o = {}) {
  return {
    makePDF: (title, lines, opts) => tplMakePDF(title, lines, { ...o.pdf, ...opts }),
    avatarSVG: tplAvatarSVG,
    imageSVG: tplImageSVG,
    imagePNG: tplImagePNG,
    attachment(a) {
      return {
        id: a.id || V.uid(),
        name: a.name,
        mime: a.mime,
        size: tplB64Size(a.data),
        data: a.data,
        title: a.title || {},
        desc: a.desc || {},
        ...(o.extra ? o.extra(a) : {}),
        asset: !!a.asset,
        added: new Date().toISOString(),
      };
    },
  };
}

/**
 * Base builder kit bound to a viewer API, a content-language list and sample files; products extend it.
 *   L(v)            i18n value: a string fills every language (language-neutral text); an object is copied as is.
 *   B(type, props)  V.newBlock(type, props).        id()  fresh item id.        icon(...names)  tplIcon.
 *   addAtt(o)       registers an attachment ({ name, mime, data (base64), title?, desc?, asset? }) -> id (K.atts).
 *   svg(name, markup, o)  registers an SVG image (markup string) as an asset attachment -> id.
 *   text / cell / mcell / table  text blocks and table grids.
 */
// L() expands a plain string into every content language (a neutral value such as a name or number), while an
// object is taken as already localised. The kit closes over `atts` so templates register attachments by side effect
// and reference them by returned id.
function tplBaseKit(V, langs, files) {
  const atts = {};
  const L = (v) => {
    const o = {};
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) o[k] = String(v[k] ?? '');
    } else {
      for (const l of langs) o[l] = v == null ? '' : String(v);
    }
    return o;
  };
  const B = (type, props = {}) => V.newBlock(type, props);
  const id = () => V.uid();
  const K = {
    L, B, id, files, langs, atts,
    icon: (...n) => tplIcon(V, ...n),
    addAtt(o) {
      const a = files.attachment({ ...o, title: L(o.title || ''), desc: L(o.desc || '') });
      atts[a.id] = a;
      return a.id;
    },
    svg(name, markup, o = {}) {
      return K.addAtt({ name, mime: 'image/svg+xml', data: b64encode(tplUtf8(markup)), asset: true, ...o });
    },
    text: (html, extra = {}) => B('text', { html: L(html), ...extra }),
    cell: (html, o = {}) => ({ html: L(html), cs: 1, rs: 1, m: false, bg: '', align: '', va: '', th: false, ...o }),
    mcell: () => ({ html: L(''), cs: 1, rs: 1, m: true, bg: '', align: '', va: '', th: false }),
    /** Table block from a rectangular grid of cells; `widths` = column widths in % (null = auto). */
    table: (rows, widths, props = {}) => B('table', { rows, cols: widths.map((w) => ({ w })), ...props }),
  };
  return K;
}

export {
  tplBaseKit,
  tplIcon,
  tplSampleFiles
};
