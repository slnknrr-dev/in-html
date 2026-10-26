// richtext/sanitize.js - DOM-based sanitizer of the editor (typing, paste, import): sanitizeHTML(html,
// 'rich' | 'inline', opts) keeps the rich-text allowlist and strips foreign document styling on paste; rtSafeHref is
// the link allowlist. Nothing touches the DOM at load time.
import { P } from '../doc/product.js';
//
// Design: REBUILD, never filter in place. The input is parsed into an inert document and walked; for every node a
// NEW element is created in the output from an allowlist, and only attributes this file constructs (href after
// rtSafeHref, style assembled from validated values, class from a fixed pattern) are set. Anything not explicitly
// produced cannot survive: unknown attributes (on*, srcdoc, formaction), namespaced SVG/MathML tricks, mutation-XSS
// shapes. Filtering in place (removing bad attributes from the parsed tree) fails open on every attribute or tag
// the denylist forgot. The output is idempotent: sanitizing its own output yields the same string, which the
// editor relies on to detect "no change".
// Two profiles: 'rich' (blocks + inline) for multi-paragraph fields, 'inline' for one-line fields (blocks become
// <br>-separated runs). 'plain' returns text only.
// ---------- Sanitizer ----------

const RT_RICH_TAGS = new Set(['p', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'br',
  'strong', 'em', 'u', 's', 'sub', 'sup', 'mark', 'a', 'span']);
const RT_INLINE_TAGS = new Set(['strong', 'em', 'u', 's', 'sub', 'sup', 'code', 'mark', 'a', 'span', 'br']);
const RT_BLOCK_TAGS = new Set(['p', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr']);
const RT_FMT_TAGS = new Set(['strong', 'em', 'u', 's', 'sub', 'sup', 'code', 'mark', 'span',
  'b', 'i', 'strike', 'del', 'ins', 'font']);
// DROP: removed with their content (scripts, media, form controls, Office VML shapes). Everything else that is not
// allowed is UNWRAPPED (content kept): pasted text inside <abbr> or <o:p> must not vanish.
// RENAME maps presentational and semantic synonyms onto the small allowlist (b -> strong, h1/h2 -> h3: the field
// sits inside a page that owns h1/h2, so pasted headings are demoted to keep the document outline valid).
const RT_DROP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'applet', 'param', 'video', 'audio', 'canvas', 'svg', 'math', 'img', 'picture', 'source', 'track', 'map',
  'area', 'input', 'select', 'textarea', 'button', 'option', 'optgroup', 'datalist', 'meter', 'progress', 'head',
  'title', 'meta', 'link', 'base', 'xml', 'dialog', 'portal', 'slot', 'rp', 'v:shape', 'v:imagedata', 'o:wrapblock']);
const RT_RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', ins: 'u', font: 'span', big: 'span', small: 'span',
  tt: 'code', kbd: 'code', samp: 'code', var: 'em', cite: 'em', dfn: 'em', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4',
  listing: 'pre', xmp: 'pre', plaintext: 'pre' };
// Block containers that are not allowed: treated like <div> (→ <p> in rich text, or unwrapped when they hold blocks).
const RT_DIVLIKE = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure',
  'figcaption', 'address', 'center', 'dl', 'dt', 'dd', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'caption', 'form', 'fieldset', 'legend', 'hgroup', 'body', 'html', 'search']);
const RT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const RT_ZW = /[\u200B\uFEFF]/g; // zero-width helpers used for caret placement; never stored
// Colours that are not a real choice: CSS-wide keywords and system colours (they follow the OS theme, so a stored
// "windowtext" would turn invisible in dark mode). On paste, greys/black/white are also dropped: Word and browsers
// stamp the source theme's text colour on every run, and keeping it would freeze black text on a dark theme.
const RT_BAD_COLORS = new Set(['transparent', 'inherit', 'initial', 'unset', 'revert', 'currentcolor', 'windowtext',
  'window', 'auto', 'none', 'buttontext', 'buttonface', 'canvastext', 'canvas', 'highlight', 'highlighttext', 'menutext']);
const RT_GREY_NAMES = /^(black|white|(dim|dark|light|slate|lightslate|darkslate)?gr[ae]y|silver|gainsboro|whitesmoke|snow|ivory|ghostwhite|floralwhite)$/;
const RT_KW_SIZE = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24,
  'xxx-large': 36, '-webkit-xxx-large': 36 };
const RT_FONT_ATTR = [0, 8, 10, 12, 14, 18, 24, 32]; // <font size="1..7"> → pt

// Shared mutable editor state (current field, saved range, pending formats, UI handles, last colours). It lives in
// this leaf module because every other richtext module already imports sanitize.js: one instance, no import
// cycles. `idoc` caches the inert parsing document.
const RT_S = { field: null, range: null, pend: null, ui: {}, pop: null, busy: false, inited: false, once: false,
  raf: 0, color: '#c00000', hl: '#fff2cc', idoc: null };

/** Inert document used for parsing: nothing loads, no scripts run. */
// document.implementation.createHTMLDocument creates a document without a browsing context: parsing HTML into it
// does not fetch <img src>, does not run scripts or inline handlers. Parsing with innerHTML on an element of the
// live page would fire <img onerror> during the parse, before any sanitizing.
function rtDoc() {
  if (!RT_S.idoc) RT_S.idoc = document.implementation.createHTMLDocument('');
  return RT_S.idoc;
}

// Escapes for text and DOUBLE-quoted attribute contexts only (no single quote): callers must use "...".
function rtEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Parse a style attribute into { prop: value } (lower-case props, !important stripped). */
// Naive split on ';' is acceptable here because values are re-validated individually (rtColor, rtFontSize,
// alignment set): a value broken by a ';' inside url(...) or a string simply fails validation and is dropped.
function rtStyleMap(el) {
  const out = {};
  const s = el.getAttribute && el.getAttribute('style');
  if (!s) return out;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).replace(/!\s*important/i, '').trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/** Validate/normalize a CSS color. paste=true drops greys/black/white (source-document defaults). */
// Output is a canonical, re-validated form (#rrggbb, rgba(), a bare hsl() of digits, or a keyword of letters),
// never the raw input, so a value like "red;background:url(x)" cannot pass. Fully transparent colours are dropped.
// Near-grey test on paste: channel spread < 40 out of 255 catches #333, #595959 and similar theme greys.
function rtColor(v, paste = false) {
  v = String(v || '').trim().toLowerCase();
  if (!v) return '';
  let rgb = null;
  let m;
  const hex = (a) => '#' + a.map((x) => x.toString(16).padStart(2, '0')).join('');
  if ((m = /^#([0-9a-f]{3,8})$/.exec(v))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return '';
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    if (a === 0) return '';
    v = a < 1 ? `rgba(${rgb.join(',')},${+a.toFixed(3)})` : hex(rgb);
  } else if ((m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v))) {
    rgb = m.slice(1, 4).map((x) => Math.max(0, Math.min(255, Math.round(x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)))));
    const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (!(a > 0)) return '';
    v = a < 1 ? `rgba(${rgb.join(',')},${+a.toFixed(3)})` : hex(rgb);
  } else if (/^hsla?\([\d.,%\s/deg]+\)$/.test(v)) {
    v = v.replace(/\s+/g, ' ');
  } else if (/^[a-z]{3,20}$/.test(v)) {
    if (RT_BAD_COLORS.has(v)) return '';
    if (paste && RT_GREY_NAMES.test(v)) return '';
  } else return '';
  if (paste && rgb && Math.max(...rgb) - Math.min(...rgb) < 40) return ''; // near-greys: theme text colours copied by browsers
  return v;
}

/** Normalize a font-size to '8pt'..'32pt' (integers) or '50%'..'300%'; '' if unusable. */
// Sizes are clamped to the editor's range (8..32 pt, 50..300 %); px converted at the CSS ratio 0.75 pt/px.
function rtFontSize(v) {
  v = String(v || '').trim().toLowerCase();
  let m;
  let pt = null;
  const pct = (p) => Math.min(300, Math.max(50, Math.round(p))) + '%';
  if ((m = /^(\d+(?:\.\d+)?)pt$/.exec(v))) pt = +m[1];
  else if ((m = /^(\d+(?:\.\d+)?)px$/.exec(v))) pt = +m[1] * 0.75;
  else if ((m = /^(\d+(?:\.\d+)?)%$/.exec(v))) return pct(+m[1]);
  else if ((m = /^(\d+(?:\.\d+)?)r?em$/.exec(v))) return pct(+m[1] * 100);
  else if (RT_KW_SIZE[v]) pt = RT_KW_SIZE[v];
  if (pt == null || !isFinite(pt) || pt <= 0) return '';
  return Math.min(32, Math.max(8, Math.round(pt))) + 'pt';
}

/** URL allowlist. Returns the cleaned href or null. */
// Allowlist of schemes (http, https, mailto, tel) plus in-document anchors of the editor's own ids (#att-*, #b-*).
// Control characters are stripped FIRST: browsers ignore them inside schemes, so "java\tscript:" would otherwise
// slip past a scheme check and execute. Relative URLs are rejected: an editor field has no base URL contract.
// Google redirect URLs are unwrapped recursively so pasted search results link to the real target (and the result
// is validated again by the same function).
function rtSafeHref(h) {
  // eslint-disable-next-line no-control-regex
  h = String(h ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!h) return null;
  if (/^#(att|b)-[A-Za-z0-9_-]+$/.test(h)) return h;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!m) return null;
  const sch = m[1].toLowerCase();
  if (sch !== 'http' && sch !== 'https' && sch !== 'mailto' && sch !== 'tel') return null;
  if (sch === 'http' || sch === 'https') {
    // Google Docs/Search wrap links in a redirect: unwrap ?q= target.
    const g = /^https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?(.*)$/i.exec(h);
    if (g) {
      try {
        const q = new URLSearchParams(g[1]).get('q') || new URLSearchParams(g[1]).get('url');
        if (q && /^https?:\/\//i.test(q)) return rtSafeHref(q);
      } catch { /* keep original */ }
    }
    if (/\s/.test(h)) h = h.replace(/\s/g, '%20');
  }
  // '<' / '>' percent-encoded: the same URL, and serialized attribute values never carry raw angle brackets.
  return h.replace(/</g, '%3C').replace(/>/g, '%3E');
}

/** Paste only: Word/Docs paragraph indentation (margin-left) → indent level 0..4. */
// Word expresses list/indent level as margin-left in many units; normalized to points, 36pt (0.5 inch, Word's
// default tab stop) per level, clamped to the editor's 4 levels.
function rtIndentLevel(st) {
  const v = st['margin-left'] || st['padding-left'] || '';
  const m = /^(-?[\d.]+)(pt|px|cm|mm|in|em|rem)?$/.exec(v.trim());
  if (!m) return 0;
  const k = { pt: 1, px: 0.75, cm: 28.35, mm: 2.835, in: 72, em: 12, rem: 12 }[m[2] || 'px'];
  return Math.max(0, Math.min(4, Math.round((parseFloat(m[1]) * k) / 36)));
}

function rtIsBlockNode(n) {
  return n.nodeType === 1 && RT_BLOCK_TAGS.has(n.localName);
}
function rtHasBlock(nodes) {
  return nodes.some(rtIsBlockNode);
}
function rtIsMark(n) {
  return n && n.nodeType === 1 && n.localName === 'span' && n.hasAttribute('data-rt-mark');
}

/** Wrap inline nodes into nested formatting elements (outermost first). Blocks → returned unchanged. */
// Style-to-tag conversion target: font-weight:bold becomes <strong>, etc. Refuses to wrap block content, since
// <strong><p>..</p></strong> is invalid and the browser would restructure it unpredictably.
function rtWrapInline(nodes, tags, d) {
  if (!tags.length || !nodes.length || rtHasBlock(nodes)) return nodes;
  let inner = null;
  let outer = null;
  for (const tg of tags) {
    const el = d.createElement(tg);
    if (inner) inner.append(el); else outer = el;
    inner = el;
  }
  inner.append(...nodes);
  return [outer];
}

/** Inline style allowed on <span>: color, background-color, font-size. */
// On paste, a colour inside a link is dropped: sources colour links blue explicitly, and the document's own link
// style should apply. MS Office highlight comes as mso-highlight.
function rtSpanStyle(n, st, ctx, inA) {
  const parts = [];
  const tag = n.localName;
  let color = st.color || (tag === 'font' ? n.getAttribute('color') : '');
  color = rtColor(color, ctx.paste);
  if (color && !(ctx.paste && inA)) parts.push('color:' + color);
  let bg = st['background-color'] || '';
  if (!bg && st.background && rtColor(st.background)) bg = st.background;
  if (!bg && st['mso-highlight']) bg = st['mso-highlight'];
  bg = rtColor(bg, ctx.paste);
  if (bg) parts.push('background-color:' + bg);
  // Paste drops sizes: source documents put an absolute size on every run (theme sizes should win).
  if (!ctx.paste) {
    let fz = st['font-size'] || '';
    if (!fz && tag === 'font' && /^[1-7]$/.test(n.getAttribute('size') || '')) fz = RT_FONT_ATTR[+n.getAttribute('size')] + 'pt';
    fz = rtFontSize(fz);
    if (fz) parts.push('font-size:' + fz);
  }
  return parts.join(';');
}

function rtCleanKids(n, ctx, pre, inA) {
  const out = [];
  for (const c of n.childNodes) for (const x of rtCleanNode(c, ctx, pre, inA)) out.push(x);
  return out;
}

/** Recursively clean one source node → array of nodes in the output document. */
// Core recursive transform: source node -> ARRAY of output nodes (0 = dropped, 1 = kept, n = unwrapped children).
// Children are cleaned first, then the parent decides to keep, rename, unwrap or drop. Whitespace collapses
// outside <pre> (HTML rendering semantics), zero-width caret helpers are removed. Hidden content (display:none,
// mso-hide, Word list bullets marked mso-list:Ignore) is dropped so invisible text does not appear after paste.
// Nested links are unwrapped (an <a> inside <a> is invalid and browsers split it). Table cells become text
// separated by spaces: tables are handled by the dedicated table feature, not by the paragraph sanitizer.
function rtCleanNode(n, ctx, pre, inA) {
  const d = ctx.d;
  if (n.nodeType === 3) {
    let s = n.data.replace(RT_ZW, '');
    if (!pre) s = s.replace(/[\t\n\r\f ]+/g, ' ');
    return s ? [d.createTextNode(s)] : [];
  }
  if (n.nodeType === 11) return rtCleanKids(n, ctx, pre, inA);
  if (n.nodeType !== 1) return []; // comments (incl. Word conditional comments), PIs
  const tag = n.localName.toLowerCase();
  if (tag === 'span' && ctx.marks && n.hasAttribute('data-rt-mark')) {
    const m = d.createElement('span');
    m.setAttribute('data-rt-mark', n.getAttribute('data-rt-mark'));
    return [m];
  }
  if (RT_DROP_TAGS.has(tag)) return [];
  const st = rtStyleMap(n);
  if (st.display === 'none' || st.visibility === 'hidden' || st['mso-hide'] === 'all' ||
    /ignore/i.test(st['mso-list'] || '') || n.hasAttribute('hidden')) return [];
  if (tag === 'br') return [d.createElement('br')];
  if (tag === 'hr') return [d.createElement(ctx.kind === 'rich' ? 'hr' : 'br')];
  if (tag === 'wbr') return [];

  let tg = RT_RENAME[tag] || tag;
  const fw = (st['font-weight'] || '').toLowerCase();
  const fs = (st['font-style'] || '').toLowerCase();
  // Google Docs wraps everything in <b style="font-weight:normal">; explicit "not bold/italic" wins over the tag.
  if (tg === 'strong' && /^(normal|lighter|[1-5]00)$/.test(fw)) tg = 'span';
  if (tg === 'em' && fs === 'normal') tg = 'span';
  const isPre = pre || tg === 'pre';
  const a = inA || tg === 'a';
  let kids = rtCleanKids(n, ctx, isPre, a);

  // style → tag conversions
  const wraps = [];
  if (/^(bold|bolder|[6-9]00)$/.test(fw) && tg !== 'strong' && !/^h[1-6]$/.test(tag)) wraps.push('strong');
  if (/^(italic|oblique)/.test(fs) && tg !== 'em') wraps.push('em');
  const deco = (st['text-decoration'] || '') + ' ' + (st['text-decoration-line'] || '');
  if (/underline/.test(deco) && tg !== 'u' && !a) wraps.push('u');
  if (/line-through/.test(deco) && tg !== 's') wraps.push('s');
  const va = st['vertical-align'];
  if (va === 'super' && tg !== 'sup') wraps.push('sup');
  else if (va === 'sub' && tg !== 'sub') wraps.push('sub');
  const sty = tg === 'hr' || tg === 'br' ? '' : rtSpanStyle(n, st, ctx, a);

  const inl = (nodes) => {
    let k = rtWrapInline(nodes, wraps, d);
    if (sty && tg !== 'span' && !rtHasBlock(k) && k.length) {
      const sp = d.createElement('span');
      sp.setAttribute('style', sty);
      sp.append(...k);
      k = [sp];
    }
    return k;
  };

  if (tag === 'td' || tag === 'th') {
    kids = inl(kids);
    if (ctx.kind === 'rich' && rtHasBlock(kids)) return kids;
    return kids.length ? [...kids, d.createTextNode(' ')] : [];
  }
  if (RT_DIVLIKE.has(tag)) {
    if (ctx.kind !== 'rich') return kids.length ? [...inl(kids), d.createElement('br')] : [];
    if (rtHasBlock(kids)) return kids;
    tg = 'p';
  }
  const allowed = ctx.kind === 'rich' ? RT_RICH_TAGS : RT_INLINE_TAGS;
  if (!allowed.has(tg)) {
    if (ctx.kind === 'inline' && RT_BLOCK_TAGS.has(tg)) return kids.length ? [...inl(kids), d.createElement('br')] : [];
    return inl(kids); // unknown element (o:p, abbr, time, custom…) → unwrap
  }
  const isBlock = RT_BLOCK_TAGS.has(tg);
  if ((tg === 'p' || tg === 'h3' || tg === 'h4') && rtHasBlock(kids)) return kids;
  if (tg === 'pre' && rtHasBlock(kids)) {
    const flat = [];
    for (const k of kids) {
      if (rtIsBlockNode(k)) { flat.push(...k.childNodes, d.createTextNode('\n')); } else flat.push(k);
    }
    kids = flat;
  }
  if (!isBlock && rtHasBlock(kids)) return kids; // inline wrapper around blocks → drop the wrapper
  if (tg === 'code' && pre) return inl(kids);
  let href = null;
  if (tg === 'a') {
    if (inA) return inl(kids);
    href = rtSafeHref(n.getAttribute('href'));
    if (!href) return inl(kids);
  }
  if (tg === 'span') {
    if (!sty) return rtWrapInline(kids, wraps, d); // empty-span collapse
  }
  const el = d.createElement(tg);
  if (href) el.setAttribute('href', href);
  if (tg === 'span') el.setAttribute('style', sty);
  if (tg === 'p' || tg === 'h3' || tg === 'h4' || tg === 'li' || tg === 'blockquote') {
    const al = (st['text-align'] || n.getAttribute('align') || '').toLowerCase();
    if (RT_ALIGNS.has(al)) el.setAttribute('style', 'text-align:' + al);
    if (tg !== 'li' && tg !== 'blockquote') {
      const cm = new RegExp('(?:^|\\s)' + P.prefix + '-i([1-4])(?:\\s|$)').exec(n.getAttribute('class') || '');
      const lvl = cm ? +cm[1] : (ctx.paste ? rtIndentLevel(st) : 0);
      if (lvl) el.setAttribute('class', P.prefix + '-i' + lvl);
    }
  }
  if (isBlock) {
    el.append(...inl(kids));
    return [el];
  }
  el.append(...kids);
  return inl([el]);
}

/** MS Word: consecutive <p style="mso-list:lN levelM"> paragraphs → nested <ul>/<ol>. Works on the source tree. */
// Word's HTML has no <ul>/<ol>: list items are <p class=MsoListParagraph style="mso-list:l0 level2 lfo1"> with a
// fake bullet in a span marked mso-list:Ignore. This pass rebuilds real nested lists on the SOURCE tree before
// cleaning: level -> nesting depth, list id + override (lfo) -> list identity, marker text -> ordered/unordered.
// Only physically adjacent paragraphs (ignoring comments/whitespace) continue a list.
function rtWordLists(root) {
  const ps = [...root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div')]
    .filter((p) => /mso-list:\s*l\d/i.test(p.getAttribute('style') || ''));
  if (!ps.length) return;
  const doc = root.ownerDocument;
  let stack = [];
  // Entries: { lvl, list, id: Word list id 'l0', lfo: list override 'lfo1', ordered }. Adjacent paragraphs of a
  // different Word list (l0 bullets then l1 numbers) or another marker kind start a new list, not a continuation.
  const differs = (a, b) => (a.id && b.id && (a.id !== b.id || a.lfo !== b.lfo)) || (a.ordered != null && b.ordered != null && a.ordered !== b.ordered);
  for (const p of ps) {
    if (!p.parentNode) continue;
    const sty = p.getAttribute('style') || '';
    const mm = /mso-list:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i.exec(sty);
    const lvl = +(mm ? mm[2] : (/level(\d+)/i.exec(sty) || [])[1] || 1) || 1;
    let sib = p.previousSibling;
    while (sib && (sib.nodeType === 8 || (sib.nodeType === 3 && !sib.data.trim()))) sib = sib.previousSibling;
    if (!stack.length || sib !== stack[0].list) stack = [];
    const ign = [...p.querySelectorAll('span')].find((s) => /mso-list:\s*ignore/i.test(s.getAttribute('style') || ''));
    const marker = (ign ? ign.textContent : '').replace(/\s+/g, '');
    const ordered = /^\(?([0-9]+|[a-z]{1,3})[.)]/i.test(marker);
    const me = { id: mm ? mm[1].toLowerCase() : '', lfo: mm ? mm[3].toLowerCase() : '', ordered: marker ? ordered : null };
    // Another list override at level 1: a new list altogether.
    if (stack.length && lvl === 1 && me.id && stack[0].id && (me.lfo !== stack[0].lfo || me.id !== stack[0].id)) stack = [];
    while (stack.length && stack[stack.length - 1].lvl > lvl) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.lvl === lvl && differs(top, me)) {
      // Close this level; the new list follows it as a sibling (root) or inside the parent's last item.
      stack.pop();
      const parent = stack[stack.length - 1];
      const L = doc.createElement(me.ordered ? 'ol' : 'ul');
      if (!parent) top.list.after(L);
      else (parent.list.lastElementChild || parent.list).append(L);
      top = { lvl, list: L, ...me };
      stack.push(top);
    }
    if (!top || top.lvl < lvl) {
      const L = doc.createElement(ordered ? 'ol' : 'ul');
      if (!top) p.before(L);
      else (top.list.lastElementChild || top.list).append(L);
      top = { lvl, list: L, ...me };
      stack.push(top);
    }
    if (top.ordered == null && me.ordered != null) top.ordered = me.ordered;
    const li = doc.createElement('li');
    li.append(...p.childNodes);
    top.list.append(li);
    p.remove();
  }
}

function rtTextOf(n) {
  return n.textContent.replace(RT_ZW, '');
}
/** Block has no visible text (nbsp counts as empty), no <hr>. */
function rtBlankEl(el) {
  return !/\S/.test(rtTextOf(el)) && !el.querySelector('hr');
}

// Repairs list structure to the content model: ul/ol may contain only li; stray text or blocks get wrapped, a
// nested list without a preceding li gets one; orphan li outside a list get a ul. Inside li, paragraphs are
// unwrapped into <br>-separated inline content (the editor's li model is inline + nested lists). guard bounds the
// loop against pathological input.
function rtFixLists(root, d, ctx) {
  for (const L of [...root.querySelectorAll('ul,ol')]) {
    let lastLi = null;
    let loose = null;
    for (const c of [...L.childNodes]) {
      if (c.nodeType === 1 && c.localName === 'li') { lastLi = c; loose = null; continue; }
      if (c.nodeType === 3 && !/\S/.test(c.data)) { c.remove(); continue; }
      if (c.nodeType === 1 && (c.localName === 'ul' || c.localName === 'ol')) {
        if (!lastLi) { lastLi = d.createElement('li'); L.insertBefore(lastLi, c); }
        lastLi.append(c);
        loose = null;
        continue;
      }
      if (rtIsBlockNode(c)) {
        const li = d.createElement('li');
        L.insertBefore(li, c);
        li.append(c);
        lastLi = li;
        loose = null;
        continue;
      }
      if (!loose) { loose = d.createElement('li'); L.insertBefore(loose, c); lastLi = loose; }
      loose.append(c);
    }
  }
  for (const li of [...root.querySelectorAll('li')]) {
    const p = li.parentNode;
    if (!p || p.localName === 'ul' || p.localName === 'ol') continue;
    const ul = d.createElement('ul');
    p.insertBefore(ul, li);
    let x = li;
    while (x && ((x.nodeType === 1 && x.localName === 'li') || (x.nodeType === 3 && !/\S/.test(x.data)))) {
      const nx = x.nextSibling;
      if (x.nodeType === 1) ul.append(x); else x.remove();
      x = nx;
    }
  }
  // <li> holds inline content (+ nested lists): unwrap paragraphs inside, separated by <br>.
  for (const li of root.querySelectorAll('li')) {
    let guard = 0;
    let blk;
    while ((blk = [...li.children].find((c) => /^(p|h3|h4|pre|blockquote|hr)$/.test(c.localName))) && guard++ < 500) {
      if (blk.localName === 'hr') { blk.remove(); continue; }
      let prev = blk.previousSibling;
      while (prev && prev.nodeType === 3 && !/\S/.test(prev.data)) prev = prev.previousSibling;
      if (prev && !(prev.nodeType === 1 && /^(br|ul|ol)$/.test(prev.localName))) blk.before(d.createElement('br'));
      blk.replaceWith(...blk.childNodes);
    }
  }
  void ctx;
}

/** Wrap runs of loose inline nodes inside a block container (root / blockquote) into <p>. */
// Root-level and blockquote-level inline runs become <p>. Runs that only contain whitespace or selection markers
// are not turned into empty paragraphs; markers are moved into a neighbouring block so the caret position survives.
function rtGroupLoose(box, d) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const real = run.some((n) => (n.nodeType === 3 ? /\S/.test(n.data) || n.data.includes('\u00a0') : !rtIsMark(n)));
    if (real) {
      const p = d.createElement('p');
      run[0].before(p);
      p.append(...run);
    } else {
      for (const n of run) {
        if (n.nodeType === 3) { n.remove(); continue; }
        // a selection marker between blocks: move it into an adjacent block so the caret survives
        let nx = n.nextSibling;
        while (nx && nx.nodeType !== 1) nx = nx.nextSibling;
        let pv = n.previousSibling;
        while (pv && pv.nodeType !== 1) pv = pv.previousSibling;
        if (nx && /^(p|h3|h4|pre|blockquote)$/.test(nx.localName)) nx.prepend(n);
        else if (pv && /^(p|h3|h4|pre|blockquote)$/.test(pv.localName)) pv.append(n);
        else { const p = d.createElement('p'); n.before(p); p.append(n); }
      }
    }
    run = [];
  };
  for (const c of [...box.childNodes]) {
    if (rtIsBlockNode(c)) flush(); else run.push(c);
  }
  flush();
}

function rtTrimText(el) {
  if (el.localName === 'pre') return;
  const w = el.ownerDocument.createTreeWalker(el, 4);
  const texts = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) texts.push(n);
  if (!texts.length) return;
  const first = texts[0];
  const last = texts[texts.length - 1];
  first.data = first.data.replace(/^[ \t\n\r]+/, '');
  last.data = last.data.replace(/[ \t\n\r]+$/, '');
  for (const br of el.querySelectorAll('br')) {
    const p = br.previousSibling;
    const n = br.nextSibling;
    if (p && p.nodeType === 3) p.data = p.data.replace(/[ \t\n\r]+$/, '');
    if (n && n.nodeType === 3) n.data = n.data.replace(/^[ \t\n\r]+/, '');
  }
  for (const n of texts) if (!n.data && n.parentNode) n.remove();
}

/** Remove empty inline elements (bottom-up); keep markers. */
function rtPruneInline(root) {
  const els = [...root.querySelectorAll('strong,em,u,s,sub,sup,code,mark,span,a')].reverse();
  for (const el of els) {
    if (rtIsMark(el)) continue;
    if (!rtTextOf(el) && !el.querySelector('br')) el.replaceWith(...el.childNodes); // markers inside move up
  }
}

function rtSameEl(a, b) {
  if (a.localName !== b.localName || rtIsMark(a) || rtIsMark(b) || a.attributes.length !== b.attributes.length) return false;
  for (const at of a.attributes) if (b.getAttribute(at.name) !== at.value) return false;
  return true;
}

/** Merge adjacent identical inline siblings; drop redundant nesting (<strong><strong>). */
// Canonicalization for idempotence and smaller output: <strong>a</strong><strong>b</strong> -> one element;
// a format nested inside the same format is unwrapped; identical nested spans collapse.
function rtMergeSiblings(root) {
  const sel = 'strong,em,u,s,sub,sup,code,mark,span,a';
  for (const el of [...root.querySelectorAll(sel)]) {
    if (!el.parentNode || rtIsMark(el)) continue;
    let nx = el.nextSibling;
    while (nx && nx.nodeType === 1 && rtSameEl(el, nx)) {
      el.append(...nx.childNodes);
      nx.remove();
      nx = el.nextSibling;
    }
  }
  for (const el of [...root.querySelectorAll('strong,em,u,s,sub,sup,code,mark')]) {
    const up = el.parentNode && el.parentNode.closest ? el.parentNode.closest(el.localName) : null;
    if (up && root.contains(up)) el.replaceWith(...el.childNodes);
  }
  for (const el of [...root.querySelectorAll('span[style]')]) {
    // <span style=X><span style=X>…</span></span> → single span
    const p = el.parentNode;
    if (p && p.localName === 'span' && p.childNodes.length === 1 && rtSameEl(p, el)) el.replaceWith(...el.childNodes);
  }
}

// Blank paragraphs: on paste they are removed (sources pad with empty <p>&nbsp;</p>); while typing they are
// normalized to <p><br></p>, the form contenteditable needs for an empty line to have height and a caret slot.
function rtFinishRich(root, ctx) {
  const d = ctx.d;
  rtFixLists(root, d, ctx);
  rtGroupLoose(root, d);
  for (const bq of [...root.querySelectorAll('blockquote')]) if ([...bq.children].some(rtIsBlockNode)) rtGroupLoose(bq, d);
  for (const b of [...root.querySelectorAll('p,h3,h4,li,pre,blockquote')]) {
    rtTrimText(b);
    if (!b.parentNode) continue;
    const marked = !!b.querySelector('[data-rt-mark]');
    if (b.localName === 'li') {
      if (rtBlankEl(b) && !b.querySelector('ul,ol')) {
        if (ctx.paste && !marked) b.remove();
        else if (!b.querySelector('br')) b.append(d.createElement('br'));
      }
      continue;
    }
    if (b.localName === 'blockquote' && [...b.children].some(rtIsBlockNode)) {
      if (!b.querySelector('p,h3,h4,pre,ul,ol,hr')) b.remove();
      continue;
    }
    if (rtBlankEl(b)) {
      if (ctx.paste && !marked) { b.remove(); continue; }
      // normalize a blank line to exactly <p><br></p> (keeping a caret marker if present)
      const marks = [...b.querySelectorAll('[data-rt-mark]')];
      b.textContent = '';
      b.append(...marks, d.createElement('br'));
    }
  }
  for (const L of [...root.querySelectorAll('ul,ol')]) if (!L.querySelector('li')) L.remove();
  // trim blank paragraphs at both ends
  const blankP = (n) => n && n.nodeType === 1 && /^(p|h3|h4|pre)$/.test(n.localName) && rtBlankEl(n) && !n.querySelector('[data-rt-mark]');
  while (blankP(root.firstElementChild) && root.firstElementChild === root.firstChild) root.firstChild.remove();
  while (blankP(root.lastElementChild) && root.lastElementChild === root.lastChild) root.lastChild.remove();
}

// Inline fields: trim leading/trailing whitespace and <br>, and allow at most two consecutive <br>, a cap that keeps
// pasted multi-paragraph text from creating tall gaps in a one-line field.
function rtFinishInline(root) {
  const isWs = (n) => n.nodeType === 3 && !/\S/.test(n.data) && !n.data.includes('\u00a0');
  const isBr = (n) => n.nodeType === 1 && n.localName === 'br';
  while (root.firstChild && (isWs(root.firstChild) || isBr(root.firstChild))) root.firstChild.remove();
  while (root.lastChild && (isWs(root.lastChild) || isBr(root.lastChild))) root.lastChild.remove();
  rtTrimText(root);
  // at most two consecutive <br>
  for (const br of [...root.querySelectorAll('br')]) {
    let n = br.nextSibling;
    let count = 1;
    while (n && isBr(n)) { count++; const nx = n.nextSibling; if (count > 2) n.remove(); n = nx; }
  }
}

/** Merge adjacent text nodes and collapse whitespace runs (outside <pre>) so output is idempotent. */
function rtCollapseWs(root) {
  root.normalize();
  const w = root.ownerDocument.createTreeWalker(root, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.parentNode.closest || !n.parentNode.closest('pre')) n.data = n.data.replace(/[\t\n\r ]+/g, ' ');
  }
}

/** Plain text: tags stripped, block boundaries → spaces, whitespace collapsed, trimmed. */
function rtPlainText(html) {
  let s = String(html ?? '');
  if (/[<&]/.test(s)) {
    const d = rtDoc();
    const el = d.createElement('div');
    el.innerHTML = s;
    for (const x of el.querySelectorAll('script,style,template')) x.remove();
    for (const b of el.querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,tr,td,th,blockquote,pre,hr')) b.after(d.createTextNode(' '));
    s = el.textContent;
  }
  return s.replace(RT_ZW, '').replace(/\s+/g, ' ').trim();
}

/**
 * sanitizeHTML(html, kind, opts) — DOM-based sanitizer.
 * kind: 'rich' | 'inline' | 'plain'. opts.paste: also strip source-document styling (Word/Docs/LibreOffice);
 * opts.marks: keep <span data-rt-mark> selection markers (editor internal).
 */
// Clipboard HTML from Windows includes the whole source document; only the part between StartFragment/EndFragment
// comments is the actual selection. Parsing goes through <template> so the parser applies the in-body insertion mode
// to any fragment (a pasted <td> or <li> is kept instead of being dropped as misplaced).
function sanitizeHTML(html, kind = 'rich', opts = {}) {
  if (kind === 'plain') return rtPlainText(html);
  if (kind !== 'inline') kind = 'rich';
  let src = String(html ?? '');
  if (!src.trim()) return '';
  const sf = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(src);
  if (sf) src = sf[1];
  const d = rtDoc();
  const tpl = d.createElement('template');
  tpl.innerHTML = src;
  const ctx = { d, kind, paste: !!opts.paste, marks: !!opts.marks };
  if (ctx.paste) rtWordLists(tpl.content);
  const root = d.createElement('div');
  root.append(...rtCleanNode(tpl.content, ctx, false, false));
  rtPruneInline(root);
  rtCollapseWs(root);
  if (kind === 'rich') rtFinishRich(root, ctx); else rtFinishInline(root);
  rtPruneInline(root);
  rtMergeSiblings(root);
  const empty = !/\S/.test(rtTextOf(root)) && !root.querySelector('hr');
  if (empty && !(ctx.marks && root.querySelector('[data-rt-mark]'))) return '';
  return root.innerHTML;
}

export {
  RT_FMT_TAGS,
  RT_S,
  RT_ZW,
  rtEsc,
  rtIsBlockNode,
  rtSafeHref,
  sanitizeHTML
};
