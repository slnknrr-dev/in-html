// ui/dom.js - DOM helpers: $, $$, h (element builder), esc, clamp, debounce, caret helpers, localStorage helpers
// (lsGet / lsSet).
//
// Design rules: zero dependencies (every other ui/ module imports this one, so it must import nothing back — no
// cycles); no framework, no virtual DOM — h() builds real nodes once and apps re-render by replacing subtrees.
// Text goes in as TEXT NODES by default (XSS-safe); HTML only through the explicit `html` attribute or esc().

// $ / $$: scoped query helpers. $$ returns a real Array (NodeList lacks map/filter in older engines and is live-ish
// for some APIs); copying once is cheap compared with surprises.
const $ =(sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
// HTML escape for text and attribute values (both quote kinds escaped, so it is safe inside "..." and '...').
// Not safe for URLs in href/src (javascript: survives escaping) nor inside <script>/<style>.
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
// Deep copy via JSON: correct for plain data documents (the only use), loses Date/Map/undefined/functions by design.
// structuredClone would keep more types but throws on functions and is missing in older embedded engines.
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const nowISO = () => new Date().toISOString();

// Element builder: h('div', {class, text, html, onclick, dataset, style, ...attrs}, ...children)
// Attribute semantics (the contract every module relies on):
//   null / undefined / false → skipped. This is how callers express optional attributes inline
//                              ('aria-current': p.current ? 'page' : null) and how textInput drops `multiline`.
//   class / text / html      → className / textContent / innerHTML. `html` is trusted markup only (icons, app
//                              templates); never pass user data there.
//   value                    → assigned AFTER children: a <select>'s value can only select an option that exists.
//   style {..}               → object form; custom properties need setProperty (style['--x'] = v is ignored).
//   on<event> fn             → addEventListener (not the on* property: several listeners stay possible).
//   checked/selected/disabled/hidden/multiple → DOM properties (live state), not attributes (initial state only).
//   true                     → boolean attribute present (''); anything else → setAttribute(String(v)).
// Children: nested arrays flattened, null/false skipped (conditional children), non-Nodes become text nodes.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') value = v;
      else if (k === 'style' && typeof v === 'object') {
        // Custom properties (--name) need setProperty; the rest are style object keys.
        for (const [p, x] of Object.entries(v)) if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x;
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'multiple') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendKids(el, kids);
  if (value !== undefined) el.value = value; // after options are appended (select)
  return el;
}
function appendKids(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) appendKids(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

// Trailing-edge debounce (fires once, ms after the last call, with the last arguments). .cancel() drops a pending
// call (e.g. on unmount); .pending() lets callers flush-or-skip on save/unload.
function debounce(fn, ms) {
  let tm = null;
  const d = (...a) => { clearTimeout(tm); tm = setTimeout(() => { tm = null; fn(...a); }, ms); };
  d.cancel = () => { clearTimeout(tm); tm = null; };
  d.pending = () => tm !== null;
  return d;
}

// Plain text of an HTML string (template content is inert: no scripts, no image loads).
// A detached <div>.innerHTML would start loading <img src> and run onerror handlers — <template> does not.
// Fast path: no '<' or '&' means nothing to parse. A space is appended after block-closing tags and <br> so
// "<p>a</p><p>b</p>" becomes "a b", not "ab"; whitespace is then collapsed.
function htmlText(html) {
  const s = String(html ?? '');
  if (!/[<&]/.test(s)) return s;
  const tp = document.createElement('template');
  tp.innerHTML = s.replace(/<(br|\/p|\/li|\/h\d|\/blockquote|\/div)\b[^>]*>/gi, (m) => m + ' ');
  return tp.content.textContent.replace(/\s+/g, ' ').trim();
}

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

// Escape for building selectors from data (ids, attribute values). CSS.escape is the correct tool.
// KNOWN DEFECT: the fallback escapes only quotes and backslashes; ids starting with a digit or containing
// spaces/brackets still produce an invalid selector (querySelector throws). Fix: a full CSS.escape polyfill, or
// use getElementById / attribute comparison instead of selectors for arbitrary data.
function cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
}

// Caret helpers for contenteditable: save the caret as a plain character offset, re-render the element, restore.
// Offsets count text-node characters only (Range.toString), so they survive markup changes that keep the text.
// Text offset of the caret inside `el` (or -1).
function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.endContainer)) return -1;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
// Walks text nodes subtracting lengths until the offset falls inside one; `<=` places a boundary offset at the END
// of the earlier node (keeps typing in the same formatting run). Offset past the end → caret at the end.
function setCaret(el, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, left = offset, placed = false;
  while ((n = walker.nextNode())) {
    if (left <= n.length) { r.setStart(n, Math.max(0, left)); placed = true; break; }
    left -= n.length;
  }
  if (!placed) { r.selectNodeContents(el); r.collapse(false); } else r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// localStorage with JSON and total failure isolation: access itself can throw (Safari private mode, storage disabled,
// sandboxed iframes, file:// in some engines), setItem throws on quota, getItem may return non-JSON written by an
// older version. Every failure returns the default / is ignored: preferences are a convenience, never a dependency.
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export {
  $,
  $$,
  appendKids,
  caretOffset,
  clamp,
  clone,
  cssEsc,
  debounce,
  esc,
  h,
  htmlText,
  isEditable,
  isObj,
  lsGet,
  lsSet,
  nowISO,
  setCaret
};
