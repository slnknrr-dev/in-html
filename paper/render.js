// paper/render.js - page skeleton of paper documents (regions in a layout, paper look, appendix of attachments) and
// the engine's block wrapper hooks (style, print classes, identity hoisting on phones).
//
// Contract: hooks called by doc/render.js; they return HTML strings / class lists and record usage into ctx. Layout is
// expressed purely as classes on the root (t- theme, l- layout, d- density, h- heading style, pa- print attachments);
// css.js keys its chunks by the same names, so markup and stylesheet stay decoupled from document values. Every class
// value goes through oneOf / own against the closed enums, never interpolated raw: a document value cannot inject a
// class name (or break out of the attribute).
import { safeColor } from '../color/color.js';
import { langDir } from '../i18n/lang.js';
import { escapeAttr } from '../html/escape.js';
import { DENSITY, HEADING_STYLES, LAYOUTS } from './themes.js';
import { attInner } from './attach.js';
import { BLOCK_TYPES, P, THEMES } from '../doc/product.js';
import { isObj, num, oneOf, own } from '../util/value.js';
import { isImage } from '../doc/attach.js';
import { blockVisible, has, icon, renderList, txt, ui } from '../doc/render.js';

/* ---------- wrappers, lists, regions, appendix ---------- */

// Block style (mm) and its wrapper class.
// Per-block user style as inline CSS. Margins go into custom properties (--mt / --mb) rather than margin itself so
// the base rule (.__P__-b in css.js) keeps control of the defaults and of :last-child; colours are validated by
// safeColor() because a raw string would allow "red;background:url(...)" style injection into the style attribute.
// The -filled class adds padding so a coloured background does not touch the text.
function blockStyle(b) {
  const s = isObj(b.style) ? b.style : {};
  const out = [];
  if (s.mt != null && s.mt !== '') out.push(`--${P.prefix}-mt:${num(s.mt, 0)}mm`);
  if (s.mb != null && s.mb !== '') out.push(`--${P.prefix}-mb:${num(s.mb, 0)}mm`);
  const bg = safeColor(s.bg);
  const co = safeColor(s.color);
  if (bg) out.push('background:' + bg);
  if (co) out.push('color:' + co);
  if (['left', 'center', 'right', 'justify'].includes(s.align)) out.push('text-align:' + s.align);
  if (s.pad != null && s.pad !== '') out.push(`padding:${num(s.pad, 0, 0, 50)}mm`);
  return { css: out.join(';'), cls: bg ? `${P.prefix}-filled` : '' };
}

// Wrapper classes: identity blocks hoisted above the main column on phones, print flags.
// Print flags become classes, not inline styles: @media print rules (css.js printCSS) need a selector to target, and
// inline style cannot be media-scoped.
function blockClasses(ctx, b, t, cls) {
  if (ctx.hoist && ctx.hoist.has(b.id)) cls += ` ${P.prefix}-hoist`;
  if (b.keep) cls += ` ${P.prefix}-keep`;
  if (b.breakBefore) cls += ` ${P.prefix}-brk`;
  if (b.print === 'print') cls += ` ${P.prefix}-print-only`;
  else if (b.print === 'screen') cls += ` ${P.prefix}-screen-only`;
  return cls;
}

// Shown only on screen or only in print: images inside are not the document's unconditional first copy.
const blockConditional = (b) => b.print === 'print' || b.print === 'screen';

function makeCtx(ctx) {
  ctx.appendixAtts = [];
}

// Link-target pre-pass: appendix attachments carry their #att-<id> targets in the appendix.
// Runs before rendering: an attachment's #att-<id> anchor must belong to exactly one element. Appendix items claim
// theirs first; a block rendered later checks ctx.attAnchor before emitting id= (blocks.js), so ids stay unique.
function planDoc(ctx) {
  const d = ctx.doc;
  if (!ctx.edit && d.output.appendix.enabled) {
    ctx.appendixAtts = Object.values(d.attachments || {}).filter((a) => isObj(a) && a.appendix && !a.asset);
  }
  for (const a of ctx.appendixAtts) ctx.attAnchor.set(a.id, 'appendix');
}

function renderAppendix(ctx) {
  const ap = ctx.doc.output.appendix;
  if (!ap.enabled || !ctx.appendixAtts.length) return '';
  const title = has(ctx, ap.title) ? txt(ctx, ap.title) : ui(ctx, 'appendix');
  // Items with an embedded preview may be tall; only card-only items get -keep (break-inside:avoid) so a long preview can split.
  let items = '';
  for (const a of ctx.appendixAtts) {
    // An image already shown inline in the body is not embedded a second time (export size); the card links to it.
    const ref = ap.embed && isImage(a) ? ctx.imgFirst.get(a.id) || null : null;
    const inner = attInner(ctx, a, { desc: true, dl: true, pr: true, op: true, embed: ap.embed, ref, height: 180 });
    items += `<div class="${P.prefix}-app-item ${P.prefix}-att${ap.embed && !ref ? '' : ` ${P.prefix}-keep`}" id="att-${escapeAttr(a.id)}">${inner}</div>`;
  }
  ctx.use.types.add('appendix');
  ctx.rendered.add('appendix');
  return `<section class="${P.prefix}-appendix${ap.print ? '' : ` ${P.prefix}-noprint`}${ap.embed ? ` ${P.prefix}-app-embed` : ''}" id="${P.prefix}-appendix">`
    + `<h2 class="${P.prefix}-app-title ${P.prefix}-hx">${icon(ctx, 'paperclip', `${P.prefix}-hd-ic`)}<span>${title}</span></h2><div class="${P.prefix}-app-list">${items}</div></section>`;
}

// Phones: ids of the leading run of side blocks (headings + the product's identity blocks, P.identityTypes: e.g. a
// resume's profile / contacts; trailing headings excluded) when that run holds such a block; those blocks are shown
// above the main column (paper/css.js CSS_RESPONSIVE: side-id).
// Returns a Set for O(1) lookups in blockClasses, called once per rendered block.
function sideIdentity(ctx, list) {
  const run = [];
  for (const b of Array.isArray(list) ? list : []) {
    if (!isObj(b) || !own(BLOCK_TYPES, b.type) || !blockVisible(ctx, b)) continue;
    if (b.type !== 'heading' && !(P.identityTypes || []).includes(b.type)) break;
    run.push(b);
  }
  while (run.length && run[run.length - 1].type === 'heading') run.pop();
  return new Set(run.some((b) => b.type !== 'heading') ? run.map((b) => b.id) : []);
}

function renderRoot(ctx) {
  const d = ctx.doc;
  const L = d.layout;
  const th = d.theme;
  const reg = (k, tag, cls) => renderList(ctx, d.regions[k], 'regions.' + k, tag, cls, '', true);
  // Editing: an empty header is left out when the product makes it optional (P.hideEmptyHeader); the outline still
  // lists it as a drop target.
  const header = ctx.edit && P.hideEmptyHeader && !(d.regions.header || []).length ? '' : reg('header', 'header', `${P.prefix}-region ${P.prefix}-header`);
  // Editor: a single-column layout still shows the sidebar while it holds blocks, so they are never invisible and unreachable.
  const showSide = !ctx.edit || L.type !== 'single' || (d.regions.side || []).length > 0;
  if (!ctx.edit && L.type !== 'single') ctx.hoist = sideIdentity(ctx, d.regions.side);
  const side = showSide ? reg('side', 'aside', `${P.prefix}-region ${P.prefix}-side`) : '';
  let top = '';
  let main;
  // headerFull: header spans both columns (sits above the grid); otherwise it lives inside the main column so the
  // sidebar starts at the top of the page.
  if (L.headerFull) {
    top = header;
    main = reg('main', 'main', `${P.prefix}-region ${P.prefix}-main ${P.prefix}-mcol`);
  } else {
    const m = reg('main', 'main', `${P.prefix}-region ${P.prefix}-main`);
    main = header || m ? `<div class="${P.prefix}-mcol">${header}${m}</div>` : '';
  }
  const app = ctx.edit ? '' : renderAppendix(ctx);
  const cols = side || main ? `<div class="${P.prefix}-cols">${side}${main}</div>` : '';
  const cls = [`${P.prefix}-root`, `${P.prefix}-t-` + (own(THEMES, th.preset) ? th.preset : 'modern'), `${P.prefix}-l-` + oneOf(L.type, LAYOUTS, 'sidebar-left'),
    `${P.prefix}-d-` + (own(DENSITY, th.density) ? th.density : 'normal'), `${P.prefix}-h-` + oneOf(th.headingStyle, HEADING_STYLES, 'line')];
  // Editor always draws the sheet (WYSIWYG for print); view mode only when the document opts in.
  if (ctx.edit || d.output.paper) cls.push(`${P.prefix}-paper`);
  if (!ctx.edit) cls.push(`${P.prefix}-pa-` + oneOf(d.output.printAttachments, ['card', 'hide', 'images'], 'card'));
  if (L.type === 'single' && L.sideInSingle === 'before') cls.push(`${P.prefix}-ss-before`);
  if (!side) cls.push(`${P.prefix}-noside`);
  else if (ctx.hoist && ctx.hoist.size) cls.push(`${P.prefix}-side-id`);
  // Edit mode: the canvas carries the edited language's direction (view mode inherits <html dir>, switched by rtI18n).
  const dir = ctx.edit ? ` dir="${langDir(ctx.lang)}"` : '';
  return `<div class="${cls.join(' ')}" data-mode="${ctx.edit ? 'edit' : 'view'}"${dir}><div class="${P.prefix}-page">${top}${cols}${app}</div></div>`;
}

export {
  blockClasses,
  blockConditional,
  blockStyle,
  makeCtx,
  planDoc,
  renderRoot
};
