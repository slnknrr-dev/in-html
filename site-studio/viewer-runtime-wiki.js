// site-studio/viewer-runtime-wiki.js - runtime feature 'wiki' of the knowledge base blocks (viewer-blocks-wiki.js),
// serialized with Function.prototype.toString like viewer-runtime.js: only R, locals and browser globals; never
// throws. Everything works by event delegation, so content opened later (a 451 section) behaves the same.
//   layers    toggles [data-wk-layer] (defaults in [data-wk-layers], choices kept per site): elements [data-layer]
//   versions  [data-wk-vers]: one version shown, buttons [data-wk-v]
//   toc       [data-wk-toc]: the headings (.kp-h) of the page the box is on, to the asked depth
//   cards     .kp-card flips (aria-pressed), .kp-spoiler shows, .kp-sortable tables sort by a header click
//   zoom      [data-kp-zoom]: the picture in a lightbox
//   451       [data-wk-seal]: the password derives the key (PBKDF2-SHA256, Web Crypto), AES-GCM opens the section;
//             the key stays in sessionStorage for this tab
//
// Why delegation (one document-level click/submit listener) rather than per-element binding: 451 sections inject
// their decrypted HTML later, and delegated handlers cover that content with no re-binding step.
function rtWiki(R) {
  var d = document;
  var hop = Object.prototype.hasOwnProperty;
  var KEY = 'wk-layers:' + (R.cfg.id || '');
  /* layers */
  var state = {};
  try { state = JSON.parse(R.store.get(KEY) || '{}') || {}; } catch (e) { state = {}; }
  var box = d.querySelector('[data-wk-layers]');
  var defs = {};
  try { defs = box ? JSON.parse(box.getAttribute('data-wk-layers')) || {} : {}; } catch (e) { defs = {}; }
  // Layers are hidden by one generated stylesheet, not by toggling each element: O(layers) work per toggle instead
  // of O(elements), and content decrypted later is covered automatically by the same rules.
  var style = d.createElement('style');
  d.head.appendChild(style);
  // Precedence: the reader's stored choice, then the site's default, then visible.
  function on(id) { return hop.call(state, id) ? !!state[id] : hop.call(defs, id) ? !!defs[id] : true; }
  function apply() {
    var off = [];
    for (var id in defs) if (hop.call(defs, id) && !on(id)) off.push(id);
    for (var id2 in state) if (hop.call(state, id2) && !state[id2] && off.indexOf(id2) < 0) off.push(id2);
    // Layer ids are sanitized to [a-z0-9-] before entering the CSS: an id is author data, and a quote or brace would
    // break out of the attribute selector. Defense in depth: normWiki and the block normalizer already restrict ids to
    // /^[a-z][a-z0-9-]{0,31}$/, so for valid documents the filter is a no-op.
    style.textContent = off.map(function (x) { return '[data-layer="' + String(x).replace(/[^a-z0-9-]/g, '') + '"]{display:none!important}'; }).join('');
    R.$$('[data-wk-layer]').forEach(function (b) {
      var v = on(b.getAttribute('data-wk-layer'));
      b.setAttribute('aria-pressed', v ? 'true' : 'false');
      if (v) b.classList.add('kp-on'); else b.classList.remove('kp-on');
    });
  }
  apply();
  /* versions */
  function showVersion(wrap, i) {
    R.$$('[data-wk-ver]', wrap).forEach(function (s) { if (s.parentNode === wrap) s.hidden = String(i) !== s.getAttribute('data-wk-ver'); });
    R.$$('[data-wk-v]', wrap).forEach(function (b) {
      var v = b.getAttribute('data-wk-v') === String(i);
      b.setAttribute('aria-pressed', v ? 'true' : 'false');
      if (v) b.classList.add('kp-on'); else b.classList.remove('kp-on');
    });
  }
  function initVersions(root) { R.$$('[data-wk-vers]', root).forEach(function (w) { if (R.$$('[data-wk-v]', w).length) showVersion(w, 0); }); }
  initVersions(d);
  /* table of contents */
  function initToc(root) {
    R.$$('[data-wk-toc]', root).forEach(function (nav) {
      // Scope the TOC to the page region it sits in: multi-page single files hold every page in the DOM, and a global
      // heading scan would list other pages' headings.
      var scope = nav.closest('main,[data-lp-page],.lp-page-in,.wk-451-in') || d.body;
      var depth = Number(nav.getAttribute('data-wk-toc')) || 3;
      var ol = nav.querySelector('ol');
      if (!ol || ol.children.length) return;
      R.$$('.kp-h', scope).forEach(function (h) {
        var lv = Number(h.tagName.slice(1));
        if (!h.id || lv > depth) return;
        var li = d.createElement('li');
        li.className = 'kp-toc-l' + lv;
        var a = d.createElement('a');
        a.href = '#' + h.id;
        a.textContent = h.textContent;
        li.appendChild(a);
        ol.appendChild(li);
      });
      if (!ol.children.length) nav.hidden = true;
    });
  }
  initToc(d);
  /* lightbox */
  // Minimal lightbox: dialog role, Escape and backdrop close, focus returned to the trigger.
  // KNOWN DEFECT: the close button's aria-label is the literal 'Close' (violates the no-UI-text rule; wrong in every
  // other language) and focus is not trapped inside the dialog. Fix: R.t('close') and a Tab-cycle handler, or <dialog>.
  function zoom(btn) {
    var img = btn.querySelector('img');
    if (!img) return;
    var lb = d.createElement('div');
    lb.className = 'kp-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    var fig = d.createElement('figure');
    var im = d.createElement('img');
    im.src = img.currentSrc || img.src;
    im.alt = img.alt || '';
    fig.appendChild(im);
    var cap = btn.closest('figure') && btn.closest('figure').querySelector('figcaption');
    if (cap) { var fc = d.createElement('figcaption'); fc.textContent = cap.textContent; fig.appendChild(fc); }
    var x = d.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close');
    lb.appendChild(fig);
    lb.appendChild(x);
    function close() { lb.remove(); d.removeEventListener('keydown', esc); try { btn.focus(); } catch (e) { /* ignore */ } }
    function esc(e) { if (e.key === 'Escape') close(); }
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target === x) close(); });
    d.addEventListener('keydown', esc);
    d.body.appendChild(lb);
    x.focus();
  }
  /* sortable tables */
  function sortBy(th) {
    var table = th.closest('table');
    var tb = table && table.tBodies[0];
    if (!tb) return;
    var k = Array.prototype.indexOf.call(th.parentNode.children, th);
    var dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
    R.$$('th[aria-sort]', table).forEach(function (x) { x.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    // Strips everything but digits, '.', '-' (so '1,234 km' -> 1234); text cells fall back to localeCompare.
    var num = function (s) { var n = Number(String(s).replace(/[\s,]/g, '').replace(/[^\d.\-]/g, '')); return /\d/.test(s) && isFinite(n) ? n : null; };
    var rows = Array.prototype.slice.call(tb.rows);
    rows.sort(function (a, b) {
      var x = (a.cells[k] || {}).textContent || '';
      var y = (b.cells[k] || {}).textContent || '';
      var nx = num(x), ny = num(y);
      if (nx != null && ny != null) return (nx - ny) * dir;
      return x.localeCompare(y, R.lang(), { numeric: true }) * dir;
    });
    rows.forEach(function (r) { tb.appendChild(r); });
  }
  /* 451 */
  var SKEY = 'wk-451:' + (R.cfg.id || '');
  function b64(s) { var b = atob(s); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // PBKDF2-SHA256 with the salt and iteration count from the envelope (chosen at export), deriving an AES-GCM-256 key.
  // NFC normalization: the same password typed on different keyboards/OSes may arrive composed or decomposed.
  // GCM authenticates the ciphertext, so a wrong password fails decrypt() outright instead of yielding garbage.
  function keyFor(pw, env) {
    var c = window.crypto && window.crypto.subtle;
    if (!c) return Promise.reject(new Error('nocrypto'));
    return c.importKey('raw', new TextEncoder().encode(String(pw).normalize('NFC')), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return c.deriveKey({ name: 'PBKDF2', salt: b64(env.s), iterations: env.i, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function openWith(sec, key) {
    var env = JSON.parse(sec.getAttribute('data-wk-seal'));
    return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct)).then(function (buf) {
      var out = sec.querySelector('[data-wk-seal-out]');
      // innerHTML of decrypted content is trusted: it was encrypted by the site author at export, and GCM's tag
      // guarantees it was not altered.
      out.innerHTML = new TextDecoder().decode(buf);
      out.hidden = false;
      sec.classList.add('wk-open');
      initVersions(out);
      initToc(out);
      apply();
      return true;
    });
  }
  function remembered() { try { return JSON.parse(sessionStorage.getItem(SKEY) || '[]') || []; } catch (e) { return []; } }
  function remember(raw) { try { var l = remembered(); if (l.indexOf(raw) < 0) l.push(raw); sessionStorage.setItem(SKEY, JSON.stringify(l.slice(-20))); } catch (e) { /* private */ } }
  // Sections already opened in this tab open again by themselves (keys exported as raw bytes, base64).
  // Trade-off: storing the derived key (not the password) avoids re-running PBKDF2 on every page, and sessionStorage
  // dies with the tab; but any script on the same origin can read it while the tab lives. Keys are tried blindly
  // against each section (GCM rejects the wrong ones), capped at the 20 most recent.
  R.$$('[data-wk-seal]').forEach(function (sec) {
    remembered().forEach(function (raw) {
      if (sec.classList.contains('wk-open') || !window.crypto || !window.crypto.subtle) return;
      window.crypto.subtle.importKey('raw', b64(raw), 'AES-GCM', false, ['decrypt']).then(function (k) { return openWith(sec, k); }).catch(function () { /* another key */ });
    });
  });
  d.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-wk-seal-form]');
    if (!f) return;
    e.preventDefault();
    var sec = f.closest('[data-wk-seal]');
    var msg = f.querySelector('.wk-451-msg');
    var pw = f.querySelector('input').value;
    var env;
    try { env = JSON.parse(sec.getAttribute('data-wk-seal')); } catch (x) { return; }
    msg.textContent = '…';
    keyFor(pw, env).then(function (key) {
      return openWith(sec, key).then(function () {
        msg.textContent = '';
        return window.crypto.subtle.exportKey('raw', key).then(function (raw) {
          var s = '', u = new Uint8Array(raw);
          for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
          remember(btoa(s));
        });
      });
    }).catch(function (err) {
      msg.textContent = err && err.message === 'nocrypto' ? R.t('wk451NoCrypto') : R.t('wk451Wrong');
      R.live(msg.textContent);
    });
  });
  /* clicks */
  d.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var x;
    // Contents and references: '#id' inside the page (hash-routed single files keep their route).
    // CSS.escape: heading ids may start with a digit or contain characters invalid in a selector.
    if ((x = t.closest('.kp-toc a[href^="#"],.kp-ref a[href^="#"],.kp-refs a[href^="#"]')) && !/^#\//.test(x.getAttribute('href'))) {
      var scope = x.closest('[data-lp-page]') || d;
      var id0 = decodeURIComponent(x.getAttribute('href').slice(1));
      var el = null;
      try { el = scope.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(id0) : id0)); } catch (err) { el = null; }
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: R.reduce() ? 'auto' : 'smooth', block: 'start' }); try { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
      return;
    }
    if ((x = t.closest('[data-wk-layer]'))) {
      var id = x.getAttribute('data-wk-layer');
      state[id] = !on(id);
      R.store.set(KEY, JSON.stringify(state));
      apply();
      return;
    }
    if ((x = t.closest('[data-wk-v]'))) { showVersion(x.closest('[data-wk-vers]'), x.getAttribute('data-wk-v')); return; }
    if ((x = t.closest('[data-kp-zoom]'))) { e.preventDefault(); zoom(x); return; }
    if ((x = t.closest('.kp-card'))) { x.setAttribute('aria-pressed', x.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); return; }
    if ((x = t.closest('.kp-spoiler'))) { x.classList.add('kp-shown'); x.setAttribute('aria-pressed', 'true'); return; }
    if ((x = t.closest('.kp-sortable thead th'))) { sortBy(x); }
  });
}

export { rtWiki };
