// html/sanitize.js - string-based rich-text sanitizer of the renderers: sanitizeRich(html, 'rich' | 'inline', opts)
// rebuilds every tag from an allowlist (Node and browsers); sanitizeDoc(html, opts): README documents like GitHub (below).
import { safeColor } from '../color/color.js';
import { escapeAttr } from './escape.js';
import { SAFE_URL, isSafeHref } from './url.js';

/* ---------- rich text allowlist ----------
   Defense in depth: the editor sanitizes rich text (DOM-based); the renderer rebuilds every tag from an
   allowlist again, so model HTML that skipped the editor (clipboard, old records, tooling) is still inert.
   Output for already-sanitized content is unchanged. */

// Why a string scanner and not DOMParser plus a tree walk: it must run in Node (build, tests) as well as browsers,
// and a rebuild-from-allowlist design is safe without reproducing the browser's parse exactly. Every emitted tag is
// generated here from a known name plus cleaned attributes; nothing from the input is copied through except text.
// Text between tags is copied verbatim: an input '&lt;' stays escaped, and a raw '<' that does not open a valid tag is
// emitted as '&lt;'. A stray '>' passes through as text, which is harmless in content.
const RICH_TAGS = new Set(['p', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'br',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'a', 'span']);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'code', 'mark', 'a', 'span', 'br']);
const VOID_TAGS = new Set(['br', 'hr']);
// Dropped together with their content.
// Raw-text and embedding elements: their content is code or foreign markup, never prose, so keeping it as text would
// leak script source into the page. Any other unknown element keeps its content (tag stripped, text kept).
const DROP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'video', 'audio', 'canvas', 'svg', 'math', 'select', 'textarea', 'button', 'title', 'head', 'xml', 'xmp',
  'noembed', 'noframes', 'plaintext']);
const ALIGN_TAGS = new Set(['p', 'h3', 'h4', 'li', 'blockquote']);
const INDENT_TAGS = new Set(['p', 'h3', 'h4']);
const ALIGNS = ['left', 'center', 'right', 'justify'];

// Attribute values are decoded before validation, so '&#106;avascript:' cannot pass the scheme check as text and be
// decoded by the browser later. Decoded values are re-escaped on output by escapeAttr.
const ENT_ALL = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|#39));?/gi;
const ENT_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
function decodeAttr(v) {
  return v.replace(ENT_ALL, (m, d, x, n) => {
    if (n) return ENT_NAMED[n.toLowerCase()];
    const cp = d ? +d : parseInt(x, 16);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
}
const WS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

// Parse one tag starting at s[i] === '<'. → { end, close, name, attrs:[[name, value|null]] } | null (not a tag).
// Follows the HTML tokenizer closely enough that the name / value split here matches the browser's: '/' between
// attributes acts as whitespace, unquoted values end at whitespace or '>', the first attribute character may be '='
// or a quote. Returns null for an unterminated tag, so the '<' is escaped instead of swallowing the rest.
function parseTag(s, i) {
  const n = s.length;
  let j = i + 1;
  const close = s[j] === '/';
  if (close) j++;
  const m = /^[A-Za-z][A-Za-z0-9:-]*/.exec(s.slice(j, j + 40));
  if (!m) return null;
  const name = m[0].toLowerCase();
  j += m[0].length;
  const attrs = [];
  for (;;) {
    while (j < n && (WS(s[j]) || s[j] === '/')) j++;
    if (j >= n) return null;
    if (s[j] === '>') return { end: j + 1, close, name, attrs };
    let k = j + 1; // a name never starts empty (browsers keep a leading = or quote in the name)
    while (k < n && !WS(s[k]) && s[k] !== '/' && s[k] !== '>' && s[k] !== '=') k++;
    const an = s.slice(j, k).toLowerCase();
    j = k;
    let p = j;
    while (p < n && WS(s[p])) p++;
    let val = null;
    if (s[p] === '=') {
      p++;
      while (p < n && WS(s[p])) p++;
      const q = s[p];
      if (q === '"' || q === "'") {
        const e = s.indexOf(q, p + 1);
        if (e < 0) return null;
        val = s.slice(p + 1, e);
        j = e + 1;
      } else {
        let e = p;
        while (e < n && !WS(s[e]) && s[e] !== '>') e++;
        val = s.slice(p, e);
        j = e;
      }
    }
    attrs.push([an, val]);
  }
}

// span style: color / background-color / font-size (8pt…32pt, 50%…300%) only.
// CSS is the classic sanitizer bypass (url(), expression(), @import, escapes), so style is rebuilt from three
// properties whose values are validated by construction: colours via safeColor, sizes via a bounded number regex.
function cleanSpanStyle(v) {
  const out = [];
  for (const decl of v.split(';')) {
    const c = decl.indexOf(':');
    if (c < 0) continue;
    const prop = decl.slice(0, c).trim().toLowerCase();
    const val = decl.slice(c + 1).trim();
    let ok = '';
    if (prop === 'color' || prop === 'background-color') ok = safeColor(val);
    else if (prop === 'font-size') {
      const m = /^(\d{1,3})(pt|%)$/.exec(val);
      if (m && (m[2] === 'pt' ? +m[1] >= 8 && +m[1] <= 32 : +m[1] >= 50 && +m[1] <= 300)) ok = val;
    }
    if (ok) out.push(prop + ':' + ok);
  }
  return out.join(';');
}

// Indent class prefix -> compiled regex. The prefix is reduced to [\w-] before compiling (no regex injection) and the
// cache avoids recompiling once per paragraph.
const indentCache = new Map();
const indentRe = (p) => {
  let re = indentCache.get(p);
  if (!re) indentCache.set(p, re = new RegExp('(?:^|\\s)(' + p.replace(/[^\w-]/g, '') + '[1-4])(?:\\s|$)'));
  return re;
};

function cleanAttrs(tag, attrs, o) {
  let s = '';
  const seen = new Set();
  for (const [an, raw] of attrs) {
    if (seen.has(an)) continue; // first occurrence wins (as in browsers)
    seen.add(an);
    const v = raw == null ? '' : decodeAttr(raw);
    let out = '';
    if (an === 'href' && tag === 'a') {
      // eslint-disable-next-line no-control-regex
      // Browsers ignore control characters inside a URL scheme (java + TAB + script: still runs); strip them first.
      const u = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (SAFE_URL.test(u) || /^#(att|b)-[A-Za-z0-9_-]+$/.test(u) || (o.anchors && isSafeHref(u, true))) out = u;
    } else if (an === 'style') {
      if (tag === 'span') out = cleanSpanStyle(v);
      else if (ALIGN_TAGS.has(tag)) {
        const m = /^\s*text-align\s*:\s*([a-z]+)\s*;?\s*$/i.exec(v);
        if (m && ALIGNS.includes(m[1].toLowerCase())) out = 'text-align:' + m[1].toLowerCase();
      }
    } else if (an === 'class' && INDENT_TAGS.has(tag) && o.indent) {
      const m = indentRe(o.indent).exec(v);
      if (m) out = m[1];
    }
    if (out) s += ` ${an}="${escapeAttr(out)}"`;
  }
  return s;
}

// Allowlist sanitizer for rich ('rich') and inline ('inline') model HTML. Linear scan; never throws.
// o = { indent: class prefix of paragraph indents ('rv-i' keeps rv-i1..rv-i4), anchors: allow #slug / #lang= links }.
// Fast path: plain text needs no work. Safe because text is copied verbatim anyway and entities stay as typed.
function sanitizeRich(html, kind = 'rich', o = {}) {
  const s = String(html == null ? '' : html);
  if (s.indexOf('<') < 0 && s.indexOf('>') < 0) return s;
  // Explicit tag stack: the output is always balanced even when the input is not.
  const allowed = kind === 'inline' ? INLINE_TAGS : RICH_TAGS;
  const n = s.length;
  const stack = [];
  let out = '';
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    i = lt;
    if (s.startsWith('<!--', i)) { // comment
      const e = s.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') { // doctype / bogus comment / processing instruction
      const e = s.indexOf('>', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const t = parseTag(s, i);
    if (!t) { out += '&lt;'; i++; continue; }
    i = t.end;
    if (DROP_TAGS.has(t.name)) {
      if (t.close) continue;
      const re = new RegExp('</' + t.name + '[\\s/>]', 'ig');
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) { i = n; continue; }
      const e = s.indexOf('>', m.index);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (!allowed.has(t.name)) continue; // unknown/forbidden element: tag dropped, content kept
    if (VOID_TAGS.has(t.name)) { if (!t.close) out += `<${t.name}>`; continue; }
    if (t.close) {
      const k = stack.lastIndexOf(t.name);
      if (k < 0) continue; // stray close tag
      while (stack.length > k) out += `</${stack.pop()}>`;
      continue;
    }
    // Nested <a> is invalid HTML; browsers split the outer link, which would desynchronise this stack from the DOM.
    if (t.name === 'a' && stack.includes('a')) continue; // no nested links
    stack.push(t.name);
    out += `<${t.name}${cleanAttrs(t.name, t.attrs, o)}>`;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

/* ---------- document allowlist (README files as GitHub / Codeberg show them) ----------
   sanitizeDoc(html, opts) keeps the elements and attributes GitHub's sanitizer keeps (headings, text semantics,
   lists, tables, details / summary, picture / source, kbd, sub / sup, ruby, images with width / height / align, align
   on blocks …) and drops style, script, iframes, forms, SVG and MathML from the user's HTML. opts:
     idPrefix   prefix of id / name values ('user-content-' like GitHub; '' keeps them), so a document cannot clobber
                the ids of the page that shows it
     dataImages keep data:image/(png|jpeg|gif|webp|avif|bmp) sources (GitHub drops them; previews may keep them)
     nonce      attributes data-md-pos / data-md-x are kept only when their value starts with '<nonce>:' (the prefix is
                removed): markers of the Markdown renderer that the document itself cannot forge
     classes    RegExp of class tokens kept (default: the renderer's own classes: md-*, markdown-alert*, footnotes,
                task-list-item, contains-task-list, language-*, hl-*) */
const DOC_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'hr', 'b', 'i', 'strong', 'em',
  'a', 'pre', 'code', 'img', 'tt', 'ins', 'del', 'sup', 'sub', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'blockquote', 'dl', 'dt', 'dd', 'kbd', 'q', 'samp', 'var', 'ruby',
  'rt', 'rp', 's', 'strike', 'summary', 'details', 'figure', 'figcaption', 'abbr', 'bdo', 'cite', 'dfn', 'mark',
  'small', 'big', 'time', 'wbr', 'picture', 'source', 'center', 'section', 'input', 'u', 'font', 'nav', 'article',
  'header', 'footer', 'aside', 'main']);
const DOC_VOID = new Set(['br', 'hr', 'img', 'wbr', 'source', 'col', 'input']);
const DOC_ATTRS = new Set(['align', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'start', 'reversed',
  'open', 'lang', 'dir', 'datetime', 'cite', 'abbr', 'scope', 'valign', 'hspace', 'vspace', 'border', 'cellpadding',
  'cellspacing', 'nowrap', 'span', 'media', 'type', 'checked', 'disabled', 'role', 'value', 'color', 'size',
  'aria-label', 'aria-hidden', 'aria-describedby', 'aria-labelledby', 'loading']);
const DOC_CLASSES = /^(md-[\w-]+|markdown-alert(-[a-z]+)?|footnotes|task-list-item|contains-task-list|language-[\w+#.-]+|hl-[a-z]|tex-[\w-]+|sr-only|data-footnote-backref)$/;
const DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i;
// Relative paths and in-page anchors (no scheme, no protocol-relative //host).
// Rejects any scheme, protocol-relative '//host' and UNC-like backslash pairs (browsers treat a backslash as '/' in
// URLs, so a double backslash is protocol-relative too).
const isRelative = (u) => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^\/\//.test(u) && !/^\\\\/.test(u);
// Allowlist by scheme: http(s) everywhere, mailto/tel only for links (an image source cannot be a phone number),
// data: only for raster images and only when opted in. SVG data URIs are excluded: SVG can carry script.
function docURL(u, img, o) {
  // eslint-disable-next-line no-control-regex
  const v = u.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!v) return '';
  if (/^https?:/i.test(v)) return v;
  if (!img && /^(mailto|tel):/i.test(v)) return v;
  if (img && o.dataImages && DATA_IMG.test(v)) return v.replace(/\s+/g, '');
  return isRelative(v) ? v : '';
}
function cleanDocAttrs(tag, attrs, o) {
  let s = '';
  const seen = new Set();
  for (const [an, raw] of attrs) {
    if (seen.has(an)) continue;
    seen.add(an);
    const v = raw == null ? '' : decodeAttr(raw);
    let out = null;
    if (an === 'href' && tag === 'a') out = docURL(v, false, o) || null;
    else if (an === 'src' && (tag === 'img' || tag === 'source')) out = docURL(v, true, o) || null;
    // srcset is a URL list: each candidate is validated like src, and one bad candidate drops the whole attribute
    // instead of emitting a partial list that would change which image the browser picks.
    else if (an === 'srcset' && (tag === 'img' || tag === 'source')) {
      const parts = v.split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const [u, ...d] = p.split(/\s+/); const ok = docURL(u, true, o); return ok ? [ok, ...d.filter((x) => /^\d+(\.\d+)?[wx]$/.test(x))].join(' ') : ''; });
      out = parts.every(Boolean) && parts.length ? parts.join(', ') : null;
    // DOM clobbering defence: user ids get a prefix so id="location" cannot shadow window.location or page elements.
    } else if (an === 'id' || an === 'name') { if (/^[\w:.-]{1,120}$/u.test(v) || /^[\p{L}\p{N}_:.-]{1,120}$/u.test(v)) out = (o.idPrefix || '') + v; }
    else if (an === 'class') out = v.split(/\s+/).filter((c) => (o.classes || DOC_CLASSES).test(c)).join(' ') || null;
    // Nonce-gated: the Markdown renderer prefixes its own markers with a per-render nonce; markers typed into the
    // document lack it and are dropped, so a README cannot forge editor source positions.
    else if (an === 'data-md-pos' || an === 'data-md-x') { if (o.nonce && v.startsWith(o.nonce + ':')) out = v.slice(o.nonce.length + 1); }
    else if (an === 'type') { if (tag === 'input' ? v === 'checkbox' : /^[\w/+.-]{1,60}$/.test(v)) out = v; }
    else if (an === 'width' || an === 'height' || an === 'hspace' || an === 'vspace' || an === 'border' || an === 'colspan' || an === 'rowspan' || an === 'start' || an === 'span') { if (/^\d{1,5}(%|px)?$/.test(v.trim())) out = v.trim(); }
    else if (an === 'align' || an === 'valign') { if (/^(left|center|right|justify|top|middle|bottom)$/i.test(v)) out = v.toLowerCase(); }
    else if (an === 'color') { const c = safeColor(v); if (c) out = c; }
    else if (DOC_ATTRS.has(an)) out = v;
    if (out == null) continue;
    s += out === '' && (an === 'open' || an === 'checked' || an === 'disabled' || an === 'reversed' || an === 'nowrap') ? ` ${an}` : ` ${an}="${escapeAttr(out)}"`;
  }
  // Inputs are forced disabled so a task-list checkbox in a rendered document never becomes a live form control.
  if (tag === 'input') s = s.replace(/ disabled(="[^"]*")?/, '') + ' disabled'; // task list checkboxes only
  return s;
}

// Same scanner as sanitizeRich, different allowlists; duplicated rather than parameterised so each hot loop stays
// monomorphic and each policy can be read top to bottom on its own.
function sanitizeDoc(html, o = {}) {
  const s = String(html == null ? '' : html);
  if (s.indexOf('<') < 0 && s.indexOf('>') < 0) return s;
  const n = s.length;
  const stack = [];
  let out = '';
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (s[i + 1] === '!' || s[i + 1] === '?') { const e = s.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }
    const t = parseTag(s, i);
    if (!t) { out += '&lt;'; i++; continue; }
    i = t.end;
    if (DROP_TAGS.has(t.name)) {
      if (t.close) continue;
      const re = new RegExp('</' + t.name + '[\\s/>]', 'ig');
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) { i = n; continue; }
      const e = s.indexOf('>', m.index);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (!DOC_TAGS.has(t.name)) continue;
    if (DOC_VOID.has(t.name)) {
      if (t.close) continue;
      const a = cleanDocAttrs(t.name, t.attrs, o);
      // An image whose every URL was rejected is dropped entirely rather than left as a broken box.
      if ((t.name === 'img' || t.name === 'source') && !/ (src|srcset)=/.test(a)) continue;
      if (t.name === 'input' && !/ type="checkbox"/.test(a)) continue;
      out += `<${t.name}${a}>`;
      continue;
    }
    if (t.close) {
      const k = stack.lastIndexOf(t.name);
      if (k < 0) continue;
      while (stack.length > k) out += `</${stack.pop()}>`;
      continue;
    }
    if (t.name === 'a' && stack.includes('a')) continue;
    stack.push(t.name);
    out += `<${t.name}${cleanDocAttrs(t.name, t.attrs, o)}>`;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

export {
  sanitizeDoc,
  sanitizeRich
};
