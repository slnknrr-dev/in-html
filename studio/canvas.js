// studio/canvas.js - the editing canvas: edit-mode rendering (whole document / one block), stylesheet, kept embedded
// previews and media players, blob URL hydration, focus restore, zoom and the stage size (ED.stage).
//
// Approach: render the whole document (or one block) to an HTML string with the same renderer the exporter uses
// (doc/render.js, mode 'edit'), parse it in an inert <template>, then swap it in. No virtual DOM / diffing:
// - one renderer for canvas and export means WYSIWYG by construction (no second implementation to drift);
// - a <template> parses without loading images or running scripts, so preview URLs can be patched before insertion;
// - the costs of wholesale replacement are handled explicitly: focus + caret are saved and restored, and expensive
//   embedded previews / media players are carried over (see "Stable attachment previews" below).
// Granularity: commit({ render: bid }) re-renders a single block, 'css' only the stylesheet; 'all' is the fallback.
import { P } from '../doc/product.js';
import { renderBlock, renderDoc } from '../doc/render.js';
import { own } from '../util/value.js';
import { previewKind } from '../doc/attach.js';
import { ED } from './config.js';
import { $, $$, caretOffset, clamp, cssEsc, debounce, esc, isEditable, lsSet, setCaret } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { S, canvas, edKey, scroller, styleEl } from './state.js';
import { findBlock } from './doc.js';
import { flushRT } from './history.js';
import { attURL, mimeOf } from './attach.js';
import { markSelection, scheduleChrome } from './select.js';
import { renderStatus } from './shell.js';
import { rtOnRender } from '../richtext/input.js';

// ===========================================================================
// 9. Canvas rendering
// ===========================================================================

function editOpts() {
  // Product options of the canvas render (ED.renderOpts: the edited page of a multi-page product…).
  const extra = ED.renderOpts ? ED.renderOpts() : null;
  return { ...(extra && typeof extra === 'object' ? extra : {}), mode: 'edit', lang: S.lang, uiLang: S.uiLang, langs: S.doc.langs, defaultLang: S.doc.defaultLang, attURL };
}

// Page stylesheet for the canvas. Font assets resolve to their cached blob URLs (edit mode), so the
// style text stays small and the font is not re-decoded on every render.
function buildEditCSS() {
  // darkPreview: the viewer adds its dark-scheme rules scoped to [data-scheme=dark] (set on the canvas by the toggle).
  return P.buildCSS(S.doc, { mode: 'edit', attURL, darkPreview: !!S.darkPreview });
}
// Canvas dark preview (stage bar toggle): checks theme.scheme 'dark' / 'auto' without exporting.
function setDarkPreview(on) {
  S.darkPreview = !!on;
  lsSet(edKey('dark'), S.darkPreview);
  applyDarkPreview();
  renderCSS();
}
function applyDarkPreview() {
  if (S.darkPreview) canvas.setAttribute('data-scheme', 'dark'); else canvas.removeAttribute('data-scheme');
  const b = $('#ed-dark-pv');
  if (b) { b.classList.toggle('ed-on', !!S.darkPreview); b.setAttribute('aria-pressed', String(!!S.darkPreview)); }
}

// Theme-only change: swap the stylesheet, keep the canvas markup (and loaded previews) untouched.
function renderCSS() {
  if (!S.doc) return;
  let css;
  try { css = buildEditCSS(); } catch (e) { console.error(e); renderCanvas(); return; }
  if (styleEl().textContent !== css) styleEl().textContent = css;
  applyCanvasSize();
  scheduleChrome();
  scheduleMeasure();
}

// Focus is identified by (block id, data-f field path, caret offset), not by element reference: the element is
// destroyed by the swap, the identity survives it.
function saveFocus() {
  const a = document.activeElement;
  if (!a || !canvas.contains(a) || !a.dataset || !a.dataset.f) return null;
  const be = a.closest('[data-bid]');
  if (!be) return null;
  return { bid: be.dataset.bid, f: a.dataset.f, off: caretOffset(a) };
}
function fieldEl(bid, f) {
  const be = blockEl(bid);
  if (!be) return null;
  return $$(`[data-f="${cssEsc(f)}"]`, be).find((x) => x.closest('[data-bid]') === be) || null;
}
function restoreFocus(fs) {
  if (!fs) return;
  const el = fieldEl(fs.bid, fs.f);
  if (!el) return;
  try { el.focus({ preventScroll: true }); if (fs.off >= 0) setCaret(el, fs.off); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Stable attachment previews. Re-creating an <object>/<iframe> reloads it (PDF plugins flicker, burn CPU and
// grab keyboard focus ~1 s later), so loaded previews are carried over into the re-rendered markup with the
// state-preserving Element.moveBefore() where available. Previews that do (re)load are guarded: if one takes
// focus shortly after loading while the pointer is not over it, focus goes back to where it was.
// ---------------------------------------------------------------------------

// moveBefore (2025+ Chromium) moves a node without the remove/insert that would reload an iframe/object or pause
// media. Without it nothing is kept (collectPreviews returns empty): appendChild-moving would reload anyway.
const CAN_MOVE = typeof Element !== 'undefined' && typeof Element.prototype.moveBefore === 'function';
const PREVIEW_SEL = 'object, iframe';
// Elements kept across re-renders: embedded previews and native media players of attachments (playing state).
const KEEP_SEL = 'object, iframe, video[data-att], audio[data-att]';
const isPreviewEl = (el) => !!el && /^(OBJECT|IFRAME|EMBED)$/.test(el.tagName);
const previewAttr = (el) => (el.tagName === 'OBJECT' ? 'data' : 'src');

function previewURL(el) {
  const u = el.getAttribute(previewAttr(el)) || '';
  if (u) return u;
  const id = el.getAttribute('data-att');
  return id ? (S.attURLs.get(id) || '') : '';
}
// Identity of a preview: same block, same element kind, same MIME type and same blob URL. Any difference means
// the new markup really shows something else and must load fresh.
function previewKey(el, url) {
  const be = el.closest('[data-bid]');
  return `${be ? be.dataset.bid : ''}|${el.tagName}|${el.getAttribute('type') || ''}|${url}`;
}

// Loaded previews inside `roots` (live DOM), keyed by block / element / type / blob URL.
function collectPreviews(roots) {
  const m = new Map();
  if (!CAN_MOVE) return m;
  for (const r of roots) {
    if (!r || r.nodeType !== 1) continue;
    for (const el of r.querySelectorAll(KEEP_SEL)) {
      const u = el.getAttribute(previewAttr(el));
      if (!u || !u.startsWith('blob:')) continue;
      const k = previewKey(el, u);
      if (!m.has(k)) m.set(k, el);
    }
  }
  return m;
}

// In the inert new markup: placeholders that match a kept preview lose their URL (so they never start
// loading) and are paired with it. Returns [[placeholder, keptElement, url], …].
function matchPreviews(kept, frag) {
  const pairs = [];
  if (!kept.size) return pairs;
  for (const ph of frag.querySelectorAll(KEEP_SEL)) {
    const u = previewURL(ph);
    if (!u) continue;
    const k = previewKey(ph, u);
    const el = kept.get(k);
    if (!el) continue;
    kept.delete(k);
    ph.removeAttribute(previewAttr(ph));
    pairs.push([ph, el, u]);
  }
  return pairs;
}

// After the new markup is in the document: move the kept previews into their placeholders.
function adoptPreviews(pairs) {
  for (const [ph, el, u] of pairs) {
    if (!ph.isConnected) continue;
    const attr = previewAttr(ph);
    // Sync attributes from the placeholder onto the kept element (classes, titles may have changed), except the URL
    // attribute, which would trigger a reload if rewritten even with the same value on some engines.
    try {
      if (!el.isConnected) throw new Error('detached');
      for (const at of [...el.attributes]) if (at.name !== attr && !ph.hasAttribute(at.name)) el.removeAttribute(at.name);
      for (const at of [...ph.attributes]) if (at.name !== attr && el.getAttribute(at.name) !== at.value) el.setAttribute(at.name, at.value);
      ph.parentNode.moveBefore(el, ph);
      ph.remove();
    } catch {
      const n = ph.cloneNode(true); // objects load reliably only when inserted with the URL set
      n.setAttribute(attr, u);
      ph.replaceWith(n);
    }
  }
}

// Replace `oldNodes` by the fragment `frag` (inserted via `insert(frag)`), keeping loaded previews.
// Returns the number of previews that were adopted.
function swapKeepingPreviews(oldNodes, frag, insert) {
  const pairs = matchPreviews(collectPreviews(oldNodes), frag);
  const frames = pairs.filter(([ph]) => ph.matches(PREVIEW_SEL)).length;
  insert(frag);
  adoptPreviews(pairs);
  for (const n of oldNodes) if (n.parentNode) n.remove();
  return frames;
}

// Preview focus guard: PDF plugins and some frames grab focus asynchronously ~1 s after load, which steals the
// caret from the field the user is typing in. Heuristic: within a short window after a (re)load, focus landing in a
// preview while the pointer is NOT over it is treated as stolen and moved back. Pointer over it = the user clicked.
const previewGuard = { until: 0, el: null, fs: null };
let lastPtr = null;          // last pointer position seen by the editor document
let lastCaret = null;        // {el, off} of the last editable that lost focus

// Called before a render that creates new previews: remember where focus is.
function armPreviewGuard() {
  const a = document.activeElement;
  previewGuard.until = Date.now() + 2500;
  previewGuard.el = a && a !== document.body && !isPreviewEl(a) ? a : null;
}

function pointerOver(el) {
  if (!lastPtr) return false;
  const r = el.getBoundingClientRect();
  return lastPtr.x >= r.left - 4 && lastPtr.x <= r.right + 4 && lastPtr.y >= r.top - 4 && lastPtr.y <= r.bottom + 4;
}

function checkPreviewFocus() {
  const a = document.activeElement;
  if (!isPreviewEl(a) || !canvas.contains(a)) return;
  if (Date.now() > previewGuard.until || pointerOver(a)) return; // the user clicked into it
  const g = previewGuard;
  let back = g.el && g.el.isConnected ? g.el : null;
  if (!back && lastCaret && lastCaret.el.isConnected) back = lastCaret.el;
  if (!back) { const fs = g.fs; if (fs) back = fieldEl(fs.bid, fs.f); }
  try {
    if (back) {
      back.focus({ preventScroll: true });
      if (lastCaret && lastCaret.el === back && lastCaret.off >= 0 && back.isContentEditable) setCaret(back, lastCaret.off);
    } else a.blur();
  } catch { /* ignore */ }
}

function bindPreviewGuard() {
  const ptr = (e) => { lastPtr = { x: e.clientX, y: e.clientY }; };
  document.addEventListener('pointermove', ptr, { passive: true, capture: true });
  document.addEventListener('pointerdown', ptr, { passive: true, capture: true });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el && el.nodeType === 1 && isEditable(el) && !isPreviewEl(el)) lastCaret = { el, off: el.isContentEditable ? caretOffset(el) : -1 };
  }, true);
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && el.nodeType === 1 && !isPreviewEl(el) && previewGuard.until > Date.now()) previewGuard.el = el;
  }, true);
  // Focus moving into a plugin / frame blurs the editor window.
  window.addEventListener('blur', () => setTimeout(checkPreviewFocus, 0));
}

// Full render. flushRT first: pending rich-text input must reach S.doc or the render would revert it.
// The stylesheet is written only when it changed: rewriting identical CSS still forces a full style recalc.
// A render error shows an in-canvas alert instead of a blank page, so the user can still undo.
function renderCanvas() {
  if (!S.doc) return;
  flushRT();
  const fs = saveFocus();
  let css = '', html = '';
  try {
    css = buildEditCSS();
    html = renderDoc(S.doc, editOpts());
  } catch (e) {
    console.error(e);
    html = `<div class="ed-render-err" role="alert">${esc(t('err.render', { msg: e.message }))}</div>`;
  }
  if (styleEl().textContent !== css) styleEl().textContent = css;
  const tp = document.createElement('template');
  tp.innerHTML = html;
  const created = tp.content.querySelectorAll(PREVIEW_SEL).length;
  const adopted = swapKeepingPreviews(Array.from(canvas.childNodes), tp.content, (frag) => canvas.append(frag));
  if (created > adopted) { armPreviewGuard(); previewGuard.fs = fs; }
  hydrate(canvas);
  applyCanvasSize();
  markSelection();
  try { rtOnRender(); } catch (e) { console.error(e); }
  restoreFocus(fs);
  scheduleChrome();
  scheduleMeasure();
}

// Re-render one block (outerHTML swap). Falls back to a full render when not in the canvas.
function rerenderBlock(id) {
  const fb = findBlock(id);
  const el = blockEl(id);
  if (!fb || !el) { renderCanvas(); return; }
  const fs = saveFocus();
  let html;
  try { html = renderBlock(fb.block, S.doc, editOpts()); }
  catch (e) { console.error(e); renderCanvas(); return; }
  const tp = document.createElement('template');
  tp.innerHTML = html;
  const nu = tp.content.firstElementChild;
  if (!nu) { renderCanvas(); return; }
  const created = tp.content.querySelectorAll(PREVIEW_SEL).length;
  const adopted = swapKeepingPreviews([el], tp.content, (frag) => el.after(frag));
  if (created > adopted) { armPreviewGuard(); previewGuard.fs = fs; }
  hydrate(nu);
  markSelection();
  try { rtOnRender(); } catch (e) { console.error(e); }
  restoreFocus(fs);
  scheduleChrome();
  scheduleMeasure();
}

// Attachment previews: make sure <object>/<img>/<iframe> referencing attachments have blob URLs.
const PDF_PREVIEW = '#toolbar=0&navpanes=0&view=FitH'; // fitted page without viewer chrome (as in the export)
// Rendered markup carries data-att ids, never URLs: blob URLs are per-session, so the renderer stays pure and the
// export can substitute data URLs instead. Security filter: <object> only for the passive allowlist of
// previewKind (an <object> of text/html would execute), iframes only when fully sandboxed (sandbox=""), media only
// for audio/ and video/ types. img draggable=false: native image drag would compete with block drag and drop.
function hydrate(root) {
  for (const o of $$('object[data-att]', root)) {
    if (o.getAttribute('data')) continue;
    // <object> only for the viewer's passive allowlist (pdf, plain text, audio/video); others keep their fallback.
    const a = own(S.doc?.attachments, o.dataset.att);
    if (!a || previewKind(a.mime) !== 'object') continue;
    const u = attURL(o.dataset.att);
    if (!u) continue;
    const n = o.cloneNode(true); // objects load reliably only when inserted with `data` set
    n.setAttribute('data', mimeOf(a) === 'application/pdf' ? u + PDF_PREVIEW : u);
    o.replaceWith(n);
  }
  for (const f of $$('iframe[data-att]', root)) {
    if (f.getAttribute('sandbox') !== '') continue; // fully sandboxed frames only (opaque origin, no scripts)
    if (!f.getAttribute('src')) { const u = attURL(f.dataset.att); if (u) f.setAttribute('src', u); }
  }
  for (const im of $$('img[data-att-img]', root)) {
    if (!im.getAttribute('src')) { const u = attURL(im.dataset.attImg); if (u) im.setAttribute('src', u); }
  }
  // Native players (background video, embed / works players): audio and video types only.
  for (const m of $$('video[data-att], audio[data-att]', root)) {
    if (m.getAttribute('src') || m.querySelector('source[src]')) continue;
    const a = own(S.doc?.attachments, m.dataset.att);
    if (!a || !/^(audio|video)\/[\w.+-]+$/.test(mimeOf(a))) continue;
    const u = attURL(m.dataset.att);
    if (u) m.setAttribute('src', u);
  }
  for (const im of $$('img', root)) im.draggable = false;
  // Previews are not keyboard stops in the editor; a freshly loaded one must not keep focus.
  const pv = root.matches?.(PREVIEW_SEL) ? [root] : $$(PREVIEW_SEL, root);
  for (const p of pv) {
    if (p.getAttribute('tabindex') !== '-1') p.setAttribute('tabindex', '-1');
    if (!p.__edGuard) {
      p.__edGuard = true;
      p.addEventListener('load', () => {
        previewGuard.until = Math.max(previewGuard.until, Date.now() + 2000);
        setTimeout(checkPreviewFocus, 0);
      });
    }
  }
}

const blockEl = (id) => (id ? canvas.querySelector(`[data-bid="${cssEsc(id)}"]`) : null);
// Direct items of a block element (not those of nested blocks).
const itemEls = (be) => $$('[data-item]', be).filter((x) => x.closest('[data-bid]') === be);

function applyCanvasSize() {
  ED.stage.apply(canvas);
  canvas.classList.toggle('ed-noguides', !S.guides);
  if (S.zoomFit) fitZoom(); else applyZoom();
}

// CSS zoom (now standard, Firefox 126+) re-lays out at the new scale, so scroll extents and hit testing are right.
// transform: scale is the fallback: purely visual, the layout box keeps its unscaled size, so the overflow is
// compensated with a negative/positive margin-bottom of (z - 1) * height, and origin top center keeps it centred.
const ZOOM_PROP = (window.CSS && CSS.supports && CSS.supports('zoom', '2')) ? 'zoom' : 'transform';
function applyZoom() {
  const z = S.zoom;
  if (ZOOM_PROP === 'zoom') { canvas.style.zoom = String(z); canvas.style.transform = ''; }
  else {
    canvas.style.transform = z === 1 ? '' : `scale(${z})`;
    canvas.style.transformOrigin = 'top center';
    canvas.style.marginBottom = z === 1 ? '' : `${(z - 1) * canvas.offsetHeight}px`;
  }
  const lbl = $('#ed-zoom-val');
  if (lbl) lbl.textContent = Math.round(z * 100) + '%';
  const fit = $('#ed-zoom-fit');
  if (fit) { fit.classList.toggle('ed-on', !!S.zoomFit); fit.setAttribute('aria-pressed', String(!!S.zoomFit)); }
}
const ZOOM_MIN = 0.25, ZOOM_MAX = 2;
// Manual zoom (buttons, Ctrl+wheel, reset) leaves fit-width mode.
function setZoom(z) {
  S.zoomFit = false;
  lsSet(edKey('zoomfit'), false);
  // Snap to 5 % steps: repeated wheel steps must not accumulate float noise (0.30000000000000004).
  S.zoom = clamp(Math.round(z * 20) / 20, ZOOM_MIN, ZOOM_MAX);
  lsSet(edKey('zoom'), S.zoom);
  applyZoom();
  scheduleChrome();
  renderStatus();
}
// Unscaled canvas width in CSS px (the stage: paper page + gutter, or the device width).
const canvasBaseWidth = () => ED.stage.baseWidth();
// Zoom at which the whole page width fits the stage (#ed-scroll has 24px side padding).
function fitZoomValue() {
  const avail = scroller.clientWidth - 48;
  if (avail <= 0) return S.zoom;
  return clamp(Math.floor((avail / canvasBaseWidth()) * 100) / 100, ZOOM_MIN, ED.stage.maxZoom || ZOOM_MAX);
}
function pageFits() {
  return scroller.clientWidth <= 0 || canvasBaseWidth() * S.zoom <= scroller.clientWidth - 48 + 1;
}
// Fit-width mode: recomputed whenever the stage or the paper size changes.
function fitZoom() {
  const z = fitZoomValue();
  const changed = Math.abs(z - S.zoom) >= 0.005;
  if (changed) S.zoom = z;
  applyZoom();
  if (changed) { scheduleChrome(); renderStatus(); }
}
function setZoomFit(on, persist = true) {
  S.zoomFit = !!on;
  if (persist) lsSet(edKey('zoomfit'), S.zoomFit);
  if (S.zoomFit) fitZoom(); else applyZoom();
  scheduleChrome();
  renderStatus();
}

// Stage measurements after layout changes (paper: page count estimate).
// Debounced 250 ms: measuring forces layout; doing it on every keystroke-driven render would be wasted work.
const scheduleMeasure = debounce(() => {
  if (!ED.stage.measure || !S.doc) return;
  ED.stage.measure();
  renderStatus();
}, 250);

export {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PROP,
  applyCanvasSize,
  applyDarkPreview,
  applyZoom,
  bindPreviewGuard,
  blockEl,
  fieldEl,
  fitZoom,
  itemEls,
  pageFits,
  renderCSS,
  renderCanvas,
  rerenderBlock,
  scheduleMeasure,
  setDarkPreview,
  setZoom,
  setZoomFit
};
