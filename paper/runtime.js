// paper/runtime.js - runtime features of exported paper documents (serialized with Function.prototype.toString;
// __P__ is the class prefix).
// core: R.$/R.$$/R.cfg/R.store (i18n, theme, attach); blob, i18n and theme are the engine's shared features
// (doc/runtime-features.js); print and links are self-contained.
//
// Why toString serialization: the exporter ships only the features a document uses, as plain source inside one
// <script>. No bundler at export time, no eval of strings, and the code is still linted / tested as normal JS here.
// Constraints that follow (fail-fast if violated, the export breaks only in the browser):
// - Each function may reference only its parameter R, its own locals and browser globals. No imports, no closures
//   over module scope: those names do not exist in the exported page.
// - ES5-style syntax (var, function expressions): exports are long-lived files opened in whatever browser the
//   recipient has, and nothing transpiles this source on the way into the export.
// - No UI text: labels are pre-rendered per language into R.cfg.aria.
// - __P__ inside strings is replaced by the product prefix when the source is emitted.
import { rtBlob, rtI18n, rtTheme } from '../doc/runtime-features.js';
// Emission order: core first (defines R.$, R.cfg, R.store used by the others), blob before attach (R.url / R.meta).
const FEATURE_ORDER = ['core', 'blob', 'i18n', 'theme', 'print', 'attach', 'links'];

/* ==========================================================================
   §I Runtime features (emitted via Function.prototype.toString into exports)
   Each function references only its parameter R, its own locals and browser
   globals. They never run in Node. No UI text here: everything visible is
   pre-rendered by the exporter.
   ========================================================================== */

// Config is a JSON <script type="application/json"> element, parsed with JSON.parse (never eval). A corrupt or
// missing config degrades to {} so the page stays readable. localStorage access is wrapped because it throws in
// sandboxed iframes, file:// in some browsers and with storage disabled.
function rtCore(R) {
  var d = document;
  R.$ = function (s, r) { return (r || d).querySelector(s); };
  R.$$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  R.cfg = {};
  try {
    var c = d.getElementById('__P__-cfg');
    if (c) R.cfg = JSON.parse(c.textContent) || {};
  } catch (e) { R.cfg = {}; }
  R.store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
}

// Self-contained (no R): a print-button-only export ships just this.
function rtPrint(R) { // eslint-disable-line no-unused-vars
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-__P__-print]') : null;
    if (!b) return;
    e.preventDefault();
    try { window.print(); } catch (err) { /* printing unavailable */ }
  });
}

function rtAttach(R) {
  var d = document;
  // Lazy previews: object/iframe get their blob URL when they approach the viewport.
  // Same rules as previewKind() in viewer.js: active formats only in sandboxed iframes, <object> only for an allowlist.
  function base(id) { return String(R.meta(id).mime || '').split(';')[0].replace(/\s+/g, '').toLowerCase(); }
  function active(id) { return /html|xml|svg|javascript|ecmascript/.test(base(id)); }
  // Re-validates before giving an element a URL: an iframe must still be sandbox="" and an <object> must have a passive
  // allowlisted type. The check mirrors render-time previewKind, so a hand-edited export cannot turn a fallback into a
  // live same-origin document.
  function hydrate(el) {
    var id = el.getAttribute('data-att');
    if (el.tagName === 'IFRAME' ? el.getAttribute('sandbox') !== '' : (active(id)
      || !/^(application\/pdf|text\/plain|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm))$/.test(base(id)))) return;
    R.url(id).then(function (u) {
      if (el.tagName === 'IFRAME') { el.src = u; return; }
      var o = el.cloneNode(true); // changing <object data> in place is unreliable; replace the node
      // PDFs: fitted page without the viewer chrome (open/download keep the bare URL).
      o.setAttribute('data', base(id) === 'application/pdf' ? u + '#toolbar=0&navpanes=0&view=FitH' : u);
      if (el.parentNode) el.parentNode.replaceChild(o, el);
    }).catch(function () { /* keep fallback content */ });
  }
  var els = R.$$('object[data-att],iframe[data-att]');
  // rootMargin 400px: start fetching a bit before the preview scrolls into view, so it is ready when seen.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) { io.unobserve(en.target); hydrate(en.target); }
      });
    }, { rootMargin: '400px 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(hydrate);
  }
  // Synthetic <a download> click: the only cross-browser way to save a blob with a file name. Removed after a delay
  // because some browsers cancel the download if the anchor disappears synchronously.
  function download(id) {
    R.url(id).then(function (u) {
      var a = d.createElement('a');
      a.href = u;
      a.download = R.meta(id).name;
      a.style.display = 'none';
      d.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    }).catch(function () { /* nothing to download */ });
  }
  // New tab without opener access; returns false when the popup was blocked.
  // opener = null: the new tab must not be able to navigate this page (reverse tabnabbing).
  function pop(u) {
    // Popup blockers allow window.open only synchronously inside the click; the blob URL resolves asynchronously, so a
    // blank tab is opened first and navigated once the URL is ready.
    var w = null;
    try { w = window.open(u, '_blank'); } catch (e) { w = null; }
    if (!w) return false;
    try { w.opener = null; } catch (e) { /* cross-origin */ }
    return true;
  }
  function open(id) {
    // HTML/SVG/XML would run as a same-origin document in a new tab: download those instead.
    if (active(id)) { download(id); return; }
    if (R.u[id]) {
      if (!pop(R.u[id])) download(id);
      return;
    }
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w) { try { w.opener = null; } catch (e) { /* ignore */ } }
    R.url(id).then(function (u) {
      if (w && !w.closed) w.location.href = u;
      else if (!pop(u)) download(id);
    }).catch(function () { if (w) w.close(); });
  }
  // Prints an attachment through a hidden iframe instead of window.print() on the page. Images get a srcdoc wrapper
  // (fits one page, waits for load); PDF / text load directly. Cleanup on afterprint, with a 60 s safety timeout
  // because afterprint is not fired for PDF viewers in some browsers. Any failure falls back to open, then download.
  function printAtt(id) {
    var b = base(id);
    var isImg = /^image\//.test(b); // drawn with <img> in the print frame (SVG scripts never run there)
    // Only passive formats are printed from a frame; anything else is downloaded (never opened as a document).
    if (!(isImg || b === 'application/pdf' || b === 'text/plain')) { download(id); return; }
    R.url(id).then(function (u) {
      var f = d.createElement('iframe');
      var done = false;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:.01;pointer-events:none';
      function cleanup() {
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 400);
      }
      function go() {
        if (done) return;
        done = true;
        try {
          var cw = f.contentWindow;
          try { cw.addEventListener('afterprint', cleanup); } catch (e1) { /* cross-context */ }
          cw.focus();
          cw.print();
        } catch (e) {
          cleanup();
          if (!pop(u)) download(id);
        }
      }
      setTimeout(cleanup, 60000);
      if (isImg) {
        f.onload = function () {
          var im = f.contentDocument && f.contentDocument.images[0];
          if (im && !im.complete) { im.onload = go; im.onerror = go; } else go();
        };
        f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:10mm}html,body{margin:0;height:100%}'
          + 'body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}'
          + '</style></head><body><img src="' + u + '" alt=""></body></html>';
      } else {
        f.onload = function () { setTimeout(go, 300); };
        f.src = u;
      }
      d.body.appendChild(f);
    }).catch(function () { open(id); });
  }
  // Pre-rendered labels (cfg.aria[lang]); the runtime itself carries no UI text.
  function label(k) {
    var a = (R.cfg && R.cfg.aria) || {};
    var v = (a[d.documentElement.lang] || {})[k];
    return v != null ? v : (a[R.cfg.defaultLang] || {})[k] || '';
  }
  // Modal image viewer: named by the image's alt text; a (visually hidden until focused) close button is the only
  // focusable element and keeps Tab; Escape, Enter/Space on the button or any click closes; focus then returns to
  // the element that opened it.
  function lightbox(img) {
    var prev = d.activeElement;
    var lb = d.createElement('div');
    var im = d.createElement('img');
    var x = d.createElement('button');
    lb.className = '__P__-lb __P__-noprint';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', img.alt || '');
    im.src = img.currentSrc || img.src;
    im.alt = img.alt || '';
    x.type = 'button';
    x.className = '__P__-lb-x';
    x.setAttribute('aria-label', label('close'));
    x.textContent = '×';
    lb.appendChild(im);
    lb.appendChild(x);
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Tab') { e.preventDefault(); x.focus(); }
    }
    function close() {
      d.removeEventListener('keydown', key, true);
      if (lb.parentNode) lb.parentNode.removeChild(lb);
      var t = prev && prev !== d.body && prev.focus ? prev : img;
      try { t.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
    }
    lb.addEventListener('click', close);
    d.addEventListener('keydown', key, true);
    d.body.appendChild(lb);
    x.focus();
  }
  // Images are made zoomable by role="button" tabindex="0" at render time (attach.js); this handles the activation.
  var ZOOM = '.__P__-b-attachment img[data-att-img],.__P__-app-item img[data-att-img]';
  // Keyboard activation like a native button: Enter on keydown, Space on keyup (so the keyup never lands on the
  // dialog's close button).
  function zoomKey(e) {
    var t = e.target;
    if (!(e.key === 'Enter' || e.key === ' ') || !t || !t.matches || !t.matches(ZOOM) || t.closest('a')) return;
    e.preventDefault();
    if ((e.type === 'keydown') === (e.key === 'Enter') && !e.repeat) lightbox(t);
  }
  d.addEventListener('keydown', zoomKey);
  d.addEventListener('keyup', zoomKey);
  var SEL = '[data-att-dl],[data-att-pr],[data-att-op]';
  // One delegated listener for all buttons and zoomable images: works for any number of attachments and costs no setup per element.
  d.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest(SEL);
    if (b) {
      e.preventDefault();
      var id = b.getAttribute('data-att');
      if (b.hasAttribute('data-att-dl')) download(id);
      else if (b.hasAttribute('data-att-pr')) printAtt(id);
      else open(id);
      return;
    }
    var img = t.closest(ZOOM);
    if (img && !t.closest('a')) { e.preventDefault(); lightbox(img); }
  });
  // Warm object URLs on hover/focus so "open" can call window.open synchronously.
  function warm(e) {
    var b = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (b) R.url(b.getAttribute('data-att')).catch(function () { /* ignore */ });
  }
  d.addEventListener('pointerover', warm);
  d.addEventListener('focusin', warm);
}

// Self-contained (no R): in-page jumps to #att-… / #b-… targets with a short highlight.
// In-page jumps with smooth scroll (instant under prefers-reduced-motion) and a flash highlight so the reader sees
// where they landed. replaceState instead of setting location.hash: no extra history entry per jump and no
// default jump that would fight the smooth scroll.
function rtLinks(R) { // eslint-disable-line no-unused-vars
  var d = document;
  function flash(el) {
    if (!el || !el.classList) return;
    el.classList.remove('__P__-flash');
    // Forces a reflow between removing and re-adding the class so the CSS animation restarts on repeated clicks.
    void el.offsetWidth;
    el.classList.add('__P__-flash');
    setTimeout(function () { el.classList.remove('__P__-flash'); }, 1900);
  }
  function go(id, save) {
    var t = d.getElementById(id);
    if (!t) return false;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); } catch (e) { t.scrollIntoView(); }
    if (save) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// quirks */ } }
    flash(t);
    return true;
  }
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a.__P__-xref') : null;
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var id = (a.getAttribute('href') || '').slice(1);
    if (id && go(id, true)) e.preventDefault();
  });
  var h = location.hash.slice(1);
  if (/^(att|b)-[a-z0-9]+$/i.test(h)) setTimeout(function () { go(h, false); }, 80);
}

const RUNTIME = { core: rtCore, blob: rtBlob, i18n: rtI18n, print: rtPrint, attach: rtAttach, links: rtLinks, theme: rtTheme };

export {
  FEATURE_ORDER,
  RUNTIME
};
