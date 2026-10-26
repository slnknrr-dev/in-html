// paper/blocks.js - generic blocks of paper documents: heading, text, table, section, columns, callout (quote), divider,
// spacer, page break, image, attachment, QR code (registry entries: schema, defaults, renderers).
//
// Registry entry contract (consumed by doc/product.js, the editor and the normalizer):
// - category / icon: palette grouping; container + lists: which child lists hold blocks ('cols.*.blocks' = wildcard);
// - i18nFields: per-language fields ({lang: html}); richFields: which of them hold sanitized rich HTML;
// - defaults(): factory of a new block; schema: editor fields (label keys must exist in every paper/i18n-*.js);
// - render(b, ctx): HTML string; '' means "renders nothing" and lets sections and regions drop empty content;
// - normalize?: per-type fixups after the engine's generic normalization.
//
// Renderer rules: every enum value is re-checked with oneOf and every number clamped with num at render time, even
// though the normalizer already did it. Renderers are also called on editor state between normalizations, and a
// render must never emit an unvalidated class name or style value. Text goes through fld / txt (escaping, editable
// fields in edit mode), attributes through escapeAttr.
import { P } from '../doc/product.js';
import { safeColor } from '../color/color.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { normURL } from '../html/url.js';
import { qrSVG } from '../qr/qr.js';
import { attInner, missingBox } from './attach.js';
import { emptyCell, normTable } from '../doc/table.js';
import { uiText } from '../doc/dict.js';
import { uid } from '../util/id.js';
import { num, oneOf } from '../util/value.js';
import { ALIGN3, numOpts, optList } from '../doc/schema.js';
import { attOf, attSrc, imgAttr, isImage } from '../doc/attach.js';
import { altAttr, editField, extAttrs, fld, has, icon, plainIn, renderList, resolveHref, txt, ui } from '../doc/render.js';

const PAPER_BLOCKS = {
  heading: {
    category: 'text', icon: 'heading', container: false,
    i18nFields: ['text'],
    defaults: () => ({ text: {}, level: 2, icon: '' }),
    schema: [
      { key: 'level', type: 'select', label: 'f.level', options: numOpts(1, 2, 3, 4) },
      { key: 'icon', type: 'icon', label: 'f.icon' },
    ],
    render: renderHeading,
  },
  text: {
    category: 'text', icon: 'text', container: false,
    i18nFields: ['html'], richFields: { html: 'rich' },
    defaults: () => ({ html: {} }),
    schema: [],
    render: (b, ctx) => fld(ctx, b, 'html', 'rich', 'div', `${P.prefix}-rich`, 'ph.text'),
  },
  table: {
    category: 'text', icon: 'table', container: false,
    i18nFields: ['caption'],
    defaults: () => ({
      rows: [0, 1, 2].map(() => [emptyCell(), emptyCell(), emptyCell()]),
      cols: [{ w: null }, { w: null }, { w: null }],
      header: 'row', style: 'grid', compact: false, caption: {}, width: 100,
    }),
    schema: [
      { key: 'header', type: 'select', label: 'f.header', options: optList('row', 'col', 'both', 'none') },
      { key: 'style', type: 'select', label: 'f.style', options: optList('grid', 'lines', 'minimal', 'striped', 'none') },
      { key: 'compact', type: 'checkbox', label: 'f.compact' },
      { key: 'width', type: 'range', label: 'f.width', min: 30, max: 100, step: 1, unit: '%' },
    ],
    render: renderTable,
    normalize: (out, b, ctx) => normTable(out, ctx.dl),
  },
  section: {
    category: 'layout', icon: 'section', container: true, lists: ['blocks'], dropEmpty: true,
    i18nFields: ['title'],
    defaults: () => ({ title: {}, icon: '', blocks: [] }),
    schema: [{ key: 'icon', type: 'icon', label: 'f.icon' }],
    render: renderSection,
  },
  columns: {
    category: 'layout', icon: 'columns', container: true, lists: ['cols.*.blocks'], listMax: 4,
    i18nFields: [],
    defaults: () => ({ cols: [{ id: uid(), w: 50, blocks: [] }, { id: uid(), w: 50, blocks: [] }], gap: 6, valign: 'top' }),
    schema: [
      { key: 'gap', type: 'number', label: 'f.gap', min: 0, max: 30, step: 1, unit: 'mm' },
      { key: 'valign', type: 'select', label: 'f.valign', options: optList('top', 'center', 'bottom') },
    ],
    render: renderColumns,
    normalize: (out) => { for (const c of out.cols) c.w = num(c.w, 50, 5, 100); },
  },
  quote: {
    category: 'text', icon: 'quote', container: false,
    i18nFields: ['html'], richFields: { html: 'rich' },
    defaults: () => ({ html: {}, tone: 'note', icon: '' }),
    schema: [
      { key: 'tone', type: 'select', label: 'f.tone', options: optList('note', 'info', 'success', 'warning', 'accent') },
      { key: 'icon', type: 'icon', label: 'f.icon' },
    ],
    render: renderQuote,
  },
  divider: {
    category: 'layout', icon: 'divider', container: false,
    i18nFields: [],
    defaults: () => ({ variant: 'solid', thickness: 1 }),
    schema: [
      { key: 'variant', type: 'select', label: 'f.variant', options: optList('solid', 'dashed', 'dotted', 'double', 'accent') },
      { key: 'thickness', type: 'number', label: 'f.thickness', min: 1, max: 6, step: 1, unit: 'px' },
    ],
    render: (b) => `<hr class="${P.prefix}-hr ${P.prefix}-hr-${oneOf(b.variant, ['solid', 'dashed', 'dotted', 'double', 'accent'], 'solid')}" style="--${P.prefix}-hrw:${num(b.thickness, 1, 1, 6)}px">`,
  },
  spacer: {
    category: 'layout', icon: 'spacer', container: false,
    i18nFields: [],
    defaults: () => ({ h: 6 }),
    schema: [{ key: 'h', type: 'number', label: 'f.h', min: 1, max: 80, step: 1, unit: 'mm' }],
    render: (b) => `<div class="${P.prefix}-sp" style="height:${num(b.h, 6, 1, 80)}mm" aria-hidden="true"></div>`,
  },
  pagebreak: {
    category: 'layout', icon: 'pagebreak', container: false, keepEmpty: true,
    i18nFields: [],
    defaults: () => ({}),
    schema: [],
    render: (b, ctx) => (ctx.edit
      ? `<div class="${P.prefix}-pbk" aria-hidden="true"><span>${escapeHTML(uiText('edit.pagebreak', ctx.uiLang, ctx.doc))}</span></div>`
      : ''),
  },
  image: {
    category: 'media', icon: 'image', container: false,
    i18nFields: ['caption'],
    defaults: () => ({ att: null, width: 100, align: 'center', caption: {}, shape: 'rect', link: '' }),
    schema: [
      { key: 'att', type: 'att', label: 'f.att', accept: 'image/' },
      { key: 'width', type: 'range', label: 'f.width', min: 10, max: 100, step: 1, unit: '%' },
      { key: 'align', type: 'select', label: 'f.align', options: ALIGN3 },
      { key: 'shape', type: 'select', label: 'f.shape', options: optList('rect', 'rounded', 'circle') },
      { key: 'link', type: 'text', label: 'f.link' },
    ],
    render: renderImage,
  },
  attachment: {
    category: 'media', icon: 'paperclip', container: false,
    i18nFields: ['caption'],
    defaults: () => ({ att: null, display: 'embed', height: 120, caption: {}, dl: true, pr: true, op: true }),
    schema: [
      { key: 'att', type: 'att', label: 'f.att', accept: '' },
      { key: 'display', type: 'select', label: 'f.display', options: optList('embed', 'card') },
      { key: 'height', type: 'number', label: 'f.height', min: 40, max: 260, step: 1, unit: 'mm', when: { display: 'embed' } },
      { key: 'dl', type: 'checkbox', label: 'f.dl' },
      { key: 'pr', type: 'checkbox', label: 'f.pr' },
      { key: 'op', type: 'checkbox', label: 'f.op' },
    ],
    render: renderAttachmentBlock,
  },
  qr: {
    category: 'media', icon: 'qr', container: false,
    i18nFields: ['label'],
    defaults: () => ({ url: '', size: 26, label: {}, ec: 'M', align: 'left' }),
    schema: [
      { key: 'url', type: 'text', label: 'f.url' },
      { key: 'size', type: 'number', label: 'f.size', min: 12, max: 60, step: 1, unit: 'mm' },
      { key: 'ec', type: 'select', label: 'f.ec', options: optList('L', 'M', 'Q', 'H') },
      { key: 'align', type: 'select', label: 'f.align', options: ALIGN3 },
    ],
    render: renderQR,
  },
};

/* ---------- block renderers ---------- */

// Only h2 gets the -hx class (the themed "section heading" look); h1/h3/h4 stay plain so a document can have a big
// title and sub-headings without each one becoming a coloured band.
function renderHeading(b, ctx) {
  const lv = oneOf(b.level, [1, 2, 3, 4], 2);
  const ic = b.icon ? icon(ctx, b.icon, `${P.prefix}-hd-ic`) : '';
  const t = fld(ctx, b, 'text', 'plain', 'span', `${P.prefix}-hd-t`, 'ph.heading');
  if (!t && !ctx.edit) return '';
  return `<h${lv} class="${P.prefix}-hd ${P.prefix}-hd${lv}${lv === 2 ? ` ${P.prefix}-hx` : ''}">${ic}${t}</h${lv}>`;
}

// Merged cells: the anchor cell carries cs/rs, covered cells are marked m and skipped, matching how HTML tables expect
// covered positions to be absent. scope= is added in view mode only (it is an AT hint; editing markup stays minimal).
function renderTable(b, ctx) {
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const cols = Array.isArray(b.cols) ? b.cols : [];
  const h = b.header;
  const hRow = h === 'row' || h === 'both';
  const hCol = h === 'col' || h === 'both';
  let body = '';
  rows.forEach((row, r) => {
    let tr = '';
    (row || []).forEach((cell, c) => {
      if (!cell || cell.m) return;
      const th = !!cell.th || (r === 0 && hRow) || (c === 0 && hCol);
      const tag = th ? 'th' : 'td';
      let a = '';
      if (cell.cs > 1) a += ` colspan="${cell.cs | 0}"`;
      if (cell.rs > 1) a += ` rowspan="${cell.rs | 0}"`;
      if (th && !ctx.edit) a += ` scope="${r === 0 && hRow ? 'col' : 'row'}"`;
      const st = [];
      const bg = safeColor(cell.bg);
      if (bg) st.push('background:' + bg);
      if (['left', 'center', 'right', 'justify'].includes(cell.align)) st.push('text-align:' + cell.align);
      if (['top', 'middle', 'bottom'].includes(cell.va)) st.push('vertical-align:' + cell.va);
      if (st.length) a += ` style="${st.join(';')}"`;
      if (ctx.edit) tr += editField(ctx, cell.html, `rows.${r}.${c}.html`, 'rich', tag, '', 'ph.cell', { attrs: ` data-r="${r}" data-c="${c}"${a}` });
      else tr += `<${tag}${a}>${txt(ctx, cell.html, 'rich')}</${tag}>`;
    });
    body += `<tr>${tr}</tr>`;
  });
  // Fixed layout only while editing (column resizing); in view mode widths are hints so words never break mid-word.
  const fixed = ctx.edit && cols.some((c) => c && c.w);
  const cg = `<colgroup>${cols.map((c) => (c && c.w ? `<col style="width:${num(c.w, 0, 0, 100)}%">` : '<col>')).join('')}</colgroup>`;
  let cap = '';
  if (ctx.edit) cap = `<caption>${fld(ctx, b, 'caption', 'plain', 'span', `${P.prefix}-tb-cap`, 'ph.caption', { ecls: `${P.prefix}-opt` })}</caption>`;
  else if (has(ctx, b.caption)) cap = `<caption>${txt(ctx, b.caption)}</caption>`;
  const cls = `${P.prefix}-table ${P.prefix}-tbs-${oneOf(b.style, ['grid', 'lines', 'minimal', 'striped', 'none'], 'grid')}`
    + (b.compact ? ` ${P.prefix}-tb-compact` : '') + (fixed ? ` ${P.prefix}-tb-fixed` : '');
  return `<div class="${P.prefix}-tbl"><table class="${cls}" style="width:${num(b.width, 100, 30, 100)}%">${cap}${cg}<tbody>${body}</tbody></table></div>`;
}

// Drop detection by searching the rendered string for the block wrapper class is cheaper than a second visibility
// walk over the subtree; it relies on doc/render.js always emitting class="<prefix>-b ..." first on wrappers.
function renderSection(b, ctx) {
  const ic = b.icon ? icon(ctx, b.icon, `${P.prefix}-hd-ic`) : '';
  const title = fld(ctx, b, 'title', 'plain', 'span', `${P.prefix}-sec-t`, 'ph.section');
  const body = renderList(ctx, b.blocks, b.id + ':blocks', 'div', `${P.prefix}-sec-body`, '', false);
  // View mode: a section none of whose blocks renders is dropped with its heading (plan() leaves it out of the xref
  // targets via sectionEmpty()).
  if (!ctx.edit && !body.includes(`class="${P.prefix}-b `)) return '';
  const head = ctx.edit || title || ic ? `<h2 class="${P.prefix}-sec-title ${P.prefix}-hx">${ic}${title}</h2>` : '';
  return head + body;
}

// Flex basis 0% with grow = width: the columns share space in the given ratio and still shrink on narrow screens.
function renderColumns(b, ctx) {
  const cols = Array.isArray(b.cols) ? b.cols : [];
  const inner = cols.map((c, i) => renderList(ctx, c.blocks, `${b.id}:cols.${i}.blocks`, 'div', `${P.prefix}-colb`,
    `flex:${num(c.w, 50, 1, 100)} 1 0%`, false)).join('');
  return `<div class="${P.prefix}-colsb ${P.prefix}-va-${oneOf(b.valign, ['top', 'center', 'bottom'], 'top')}" style="--${P.prefix}-cg:${num(b.gap, 6, 0, 30)}mm">${inner}</div>`;
}

function renderQuote(b, ctx) {
  const body = fld(ctx, b, 'html', 'rich', 'div', `${P.prefix}-qt-body ${P.prefix}-rich`, 'ph.text');
  if (!body) return '';
  const ic = b.icon ? icon(ctx, b.icon, `${P.prefix}-qt-ic`) : '';
  return `<div class="${P.prefix}-qt ${P.prefix}-qt-${oneOf(b.tone, ['note', 'info', 'success', 'warning', 'accent'], 'note')}" role="note">${ic}${body}</div>`;
}

// alt text per language (altAttr): caption, else attachment title, else file name, so an image is never unnamed.
// The #att-<id> anchor goes only on the block that won it in planDoc (unique ids).
function renderImage(b, ctx) {
  const a = attOf(ctx, b.att);
  const src = a && isImage(a) ? attSrc(ctx, a) : '';
  if (!src) return ctx.edit ? missingBox(ctx, 'image') : '';
  const alt = altAttr(ctx, (l) => plainIn(ctx, b.caption, l) || plainIn(ctx, a.title, l) || a.name);
  const shape = oneOf(b.shape, ['rect', 'rounded', 'circle'], 'rect');
  let img = `<img class="${P.prefix}-img ${P.prefix}-sh-${shape}" src="${escapeAttr(src)}"${alt}${imgAttr(ctx, a)}>`;
  if (!ctx.edit && b.link) {
    const href = resolveHref(ctx, normURL(b.link));
    if (href) img = `<a href="${escapeAttr(href)}"${href[0] === '#' ? ` class="${P.prefix}-xref"` : extAttrs(href)}>${img}</a>`;
  }
  const anchor = !ctx.edit && ctx.attAnchor.get(a.id) === b.id ? ` id="att-${escapeAttr(a.id)}"` : '';
  const cap = fld(ctx, b, 'caption', 'plain', 'figcaption', `${P.prefix}-cap`, 'ph.caption', { ecls: `${P.prefix}-opt` });
  return `<figure class="${P.prefix}-fig ${P.prefix}-al-${oneOf(b.align, ['left', 'center', 'right'], 'center')}" style="width:${num(b.width, 100, 10, 100)}%"${anchor}>${img}${cap}</figure>`;
}

// An embedded image already shown earlier in the body is linked (ref), not embedded twice: halves export size for repeated pictures.
function renderAttachmentBlock(b, ctx) {
  const a = attOf(ctx, b.att);
  if (!a) return ctx.edit ? missingBox(ctx, 'paperclip') : '';
  const card = b.display === 'card';
  const anchor = !ctx.edit && ctx.attAnchor.get(a.id) === b.id ? ` id="att-${escapeAttr(a.id)}"` : '';
  const ref = !card && !ctx.edit && isImage(a) ? ctx.imgFirst.get(a.id) || null : null;
  const inner = attInner(ctx, a, { blk: b, dl: b.dl, pr: b.pr, op: b.op, embed: !card, ref, height: b.height });
  return `<div class="${P.prefix}-att${card ? ` ${P.prefix}-att-card` : ''}"${anchor}>${inner}</div>`;
}

// QR ink: theme text when it is dark enough, else black (scanners need contrast).
// QR ink: theme text when it is dark enough, else black (scanners need contrast against the white quiet zone).
// Rec. 601 luma on gamma-encoded sRGB is an approximation of perceived lightness; the 0.35 cutoff is conservative
// enough that the approximation error does not matter. Non-#rrggbb values fall back to black.
function qrInk(ctx) {
  const m = /^#([0-9a-f]{6})$/i.exec(ctx.doc.theme.text || '');
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.35 ? '#' + m[1] : '#000000';
}

function renderQR(b, ctx) {
  const url = normURL(b.url);
  const size = num(b.size, 26, 12, 60);
  const al = oneOf(b.align, ['left', 'center', 'right'], 'left');
  const cap = fld(ctx, b, 'label', 'plain', 'figcaption', `${P.prefix}-qr-l`, 'ph.label', { ecls: `${P.prefix}-opt` });
  if (!url) {
    return ctx.edit
      ? `<figure class="${P.prefix}-qr ${P.prefix}-al-${al}"><span class="${P.prefix}-qr-code ${P.prefix}-qr-ph" style="width:${size}mm;height:${size}mm">${icon(ctx, 'qr')}</span>${cap}</figure>`
      : '';
  }
  let svg = '';
  // qrSVG throws when the data exceeds QR capacity at this EC level; the block then shows only the label rather than failing the export.
  try { svg = qrSVG(url, { ec: oneOf(b.ec, ['L', 'M', 'Q', 'H'], 'M'), fg: qrInk(ctx) }); } catch (e) { svg = ''; }
  // The SVG is aria-hidden; a visually hidden, per-language "Scan the QR code: <url>" names the code (and its link).
  const sr = `<span class="${P.prefix}-sr">${ctx.edit ? escapeHTML(uiText('scanQr', ctx.uiLang, ctx.doc)) : ui(ctx, 'scanQr')}: ${escapeHTML(url)}</span>`;
  let code = `<span class="${P.prefix}-qr-code" style="width:${size}mm">${svg}${sr}</span>`;
  if (!ctx.edit) code = `<a class="${P.prefix}-qr-a" href="${escapeAttr(url)}"${extAttrs(url)}>${code}</a>`;
  return `<figure class="${P.prefix}-qr ${P.prefix}-al-${al}">${code}${cap}</figure>`;
}

export {
  PAPER_BLOCKS
};
