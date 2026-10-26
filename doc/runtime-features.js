// doc/runtime-features.js - runtime features shared by every document product (serialized with
// Function.prototype.toString like the products' own; __P__ is the class prefix):
//   rtBlob   attachment data: R.meta(id), R.blob(id) → Promise<Blob>, R.url(id) → Promise<object URL>, R.u (resolved)
//   rtI18n   language detection and switching: <html lang dir>, title / description / og tags, [data-set-lang]
//            controls, data-alt / data-__P__-i18n attributes, form placeholders and select options
//            (data-__P__-ph / -opts), cfg.pageCSS (print header / footer), event __P__:lang
//   rtTheme  light / dark switch ([data-__P__-scheme] buttons, saved per document, theme-color follows the page)
// They need from the product's core feature: R.$$(selector), R.cfg (parsed #__P__-cfg) and R.store.get / set.
//
// Style is deliberately ES5 (var, function, no arrow / class): this code ships as text into exported pages that may
// be opened in old embedded webviews, and it bypasses the app bundler's transpilation. No module-scope references
// (see runtime.js). Every storage / Intl / matchMedia access is wrapped: exported files run under file://, in
// private modes and sandboxed iframes where these APIs throw.

function rtBlob(R) {
  var d = document;
  var hop = Object.prototype.hasOwnProperty;
  R.meta = function (id) {
    var atts = R.cfg.atts || {};
    var a = hop.call(atts, id) ? atts[id] || [] : [];
    var s = d.getElementById('__P__-att-' + id);
    return {
      name: (s && s.getAttribute('data-name')) || a[0] || 'file',
      mime: (s && s.getAttribute('data-mime')) || a[1] || 'application/octet-stream',
    };
  };
  var blobs = {};
  var urls = {};
  R.u = {}; // resolved object URLs (sync access for popup-safe window.open)
  // Promises are memoised per id so repeated clicks decode the base64 once; a rejected promise is evicted so a later
  // attempt can retry instead of replaying the failure forever.
  R.blob = function (id) {
    if (blobs[id]) return blobs[id];
    var p = new Promise(function (res, rej) {
      var m = R.meta(id);
      var s = d.getElementById('__P__-att-' + id);
      if (s) {
        var bin = atob(s.textContent.replace(/\s+/g, ''));
        var n = bin.length;
        var u = new Uint8Array(n);
        for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
        res(new Blob([u], { type: m.mime }));
        return;
      }
      // Images embedded inline (data: URI) are their own store; compared by value, never put into a selector.
      var img = null;
      R.$$('img[data-att-img]').some(function (x) { if (x.getAttribute('data-att-img') === id) { img = x; return true; } return false; });
      if (img) {
        var src = img.currentSrc || img.src || '';
        var dm = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(src);
        if (!dm) { rej(new Error('no inline data')); return; }
        // Non-base64 data URI: percent-decoding gives a JS string of code points; unescape(encodeURIComponent(..))
        // turns it into a binary string of its UTF-8 bytes, which the loop below copies byte by byte.
        var raw = /;base64/i.test(dm[2]) ? atob(dm[3].replace(/\s+/g, '')) : unescape(encodeURIComponent(decodeURIComponent(dm[3])));
        var bytes = new Uint8Array(raw.length);
        for (var j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
        res(new Blob([bytes], { type: dm[1] || m.mime }));
        return;
      }
      rej(new Error('__P__: no data for ' + id));
    });
    blobs[id] = p;
    p.catch(function () { delete blobs[id]; });
    return p;
  };
  // Object URLs are never revoked: they back links the user may click at any time during the page's life, and the
  // page owns at most one URL per attachment. R.u gives synchronous access so a click handler can call window.open
  // inside the user gesture (an await first would get the popup blocked).
  R.url = function (id) {
    if (!urls[id]) {
      urls[id] = R.blob(id).then(function (b) { var u = URL.createObjectURL(b); R.u[id] = u; return u; });
      urls[id].catch(function () { delete urls[id]; });
    }
    return urls[id];
  };
}

function rtI18n(R) {
  var d = document;
  var h = d.documentElement;
  var c = R.cfg || {};
  var langs = c.langs || [];
  if (langs.length < 2) return;
  // Storage key scoped by document id: two exported documents on one origin (same folder under file://) must not
  // share a saved language.
  var key = '__P__-lang:' + (c.id || '');
  // Allowlist of attributes the per-language map may set: without it a crafted data attribute could set href,
  // srcdoc or an on* handler.
  var ATTRS = /^(alt|title|placeholder|aria-label|aria-description)$/;
  function find(l) {
    if (!l) return null;
    l = String(l).toLowerCase();
    for (var i = 0; i < langs.length; i++) if (langs[i].toLowerCase() === l) return langs[i];
    return null;
  }
  function script(l) {
    try { return new Intl.Locale(l).maximize().script || null; } catch (e) { return null; }
  }
  // Best output language for a BCP 47 tag: exact → truncated prefixes (zh-Hant-TW → zh-Hant → zh) → same primary
  // language with the same (likely) script (sr-Latn, zh-TW → zh-Hant) → the bare primary language → first candidate.
  function best(tag) {
    tag = String(tag || '').replace(/_/g, '-');
    if (!tag) return null;
    var parts = tag.split('-');
    var x;
    for (var n = parts.length; n > 0; n--) if ((x = find(parts.slice(0, n).join('-')))) return x;
    var p = parts[0].toLowerCase();
    var cand = langs.filter(function (l) { return l.toLowerCase().split('-')[0] === p; });
    if (!cand.length) return null;
    var scr = script(tag);
    if (scr) for (var i = 0; i < cand.length; i++) if (script(cand[i]) === scr) return cand[i];
    for (var j = 0; j < cand.length; j++) if (cand[j].indexOf('-') < 0) return cand[j];
    return cand[0];
  }
  // Precedence: ?lang= / #lang= → saved choice → navigator.languages (in preference order) → default language.
  function detect() {
    var x;
    var m = /[?&#]lang=([A-Za-z0-9_-]+)/.exec(location.search + location.hash);
    if (m && (x = best(m[1]))) return x;
    if ((x = best(R.store.get(key)))) return x;
    if (c.autodetect !== false) {
      var nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
      for (var i = 0; i < nav.length; i++) if ((x = best(nav[i]))) return x;
    }
    return find(c.defaultLang) || find(h.lang) || langs[0];
  }
  function perLang(json) {
    var m = null;
    try { m = JSON.parse(json); } catch (e) { m = null; }
    return m && typeof m === 'object' ? m : null;
  }
  // Idempotent: applies the whole state for language l every time (no diffing), so calling it twice is harmless and
  // elements added later only need another apply. Visible text itself is switched by CSS on html[lang], not here.
  // save=false on startup: an auto-detected language must not become a sticky user choice.
  function apply(l, save) {
    if (!l) return;
    h.lang = l;
    h.dir = (c.dirs && c.dirs[l]) || 'ltr';
    var t = c.titles && c.titles[l];
    if (t) d.title = t;
    var desc = c.descs && c.descs[l] != null ? c.descs[l] : null;
    var md = d.querySelector('meta[name="description"]');
    if (md && desc != null) md.setAttribute('content', desc);
    var og = d.querySelector('meta[property="og:title"]');
    if (og && t) og.setAttribute('content', t);
    var ogd = d.querySelector('meta[property="og:description"]');
    if (ogd && desc != null) ogd.setAttribute('content', desc);
    // Per-language page CSS (print margin boxes: running header / footer, page numbers).
    var ps = d.getElementById('__P__-page-css');
    if (ps && c.pageCSS) ps.textContent = c.pageCSS[l] || '';
    // Pre-rendered accessible labels (cfg.aria[lang]) and per-language attributes.
    var ar = (c.aria && c.aria[l]) || {};
    R.$$('.__P__-toolbar').forEach(function (tb) { if (ar.toolbar) tb.setAttribute('aria-label', ar.toolbar); });
    R.$$('[data-set-lang]').forEach(function (el) {
      if (el.tagName === 'SELECT') {
        el.value = l;
        if (ar.language) el.setAttribute('aria-label', ar.language);
      } else el.setAttribute('aria-pressed', el.getAttribute('data-set-lang') === l ? 'true' : 'false');
    });
    // data-alt='{"en":"…"}': alt text per language; the original stays in data-alt0.
    R.$$('[data-alt]').forEach(function (el) {
      if (!el.hasAttribute('data-alt0')) el.setAttribute('data-alt0', el.getAttribute('alt') || '');
      var mm = perLang(el.getAttribute('data-alt'));
      el.setAttribute('alt', mm && typeof mm[l] === 'string' ? mm[l] : el.getAttribute('data-alt0'));
    });
    // data-__P__-i18n='{"placeholder":{"en":"…","ru":"…"},"aria-label":{…}}': allowlisted attributes per language.
    R.$$('[data-__P__-i18n]').forEach(function (el) {
      var mm = perLang(el.getAttribute('data-__P__-i18n'));
      if (!mm) return;
      for (var a in mm) {
        if (!Object.prototype.hasOwnProperty.call(mm, a) || !ATTRS.test(a)) continue;
        var vv = mm[a] && typeof mm[a] === 'object' ? mm[a][l] : null;
        if (typeof vv === 'string') el.setAttribute(a, vv);
      }
    });
    // Form controls: data-__P__-ph='{"en":"…"}' placeholders, data-__P__-opts='{"en":["Choose…","A",…]}' option labels
    // of a <select> by position (the submitted values stay the default-language texts).
    R.$$('[data-__P__-ph]').forEach(function (el) {
      var mm = perLang(el.getAttribute('data-__P__-ph'));
      if (mm && typeof mm[l] === 'string') el.setAttribute('placeholder', mm[l]);
    });
    R.$$('select[data-__P__-opts]').forEach(function (sel) {
      var mm = perLang(sel.getAttribute('data-__P__-opts'));
      var list = mm && mm[l];
      if (!Array.isArray(list)) return;
      for (var k = 0; k < sel.options.length && k < list.length; k++) if (typeof list[k] === 'string') sel.options[k].textContent = list[k];
    });
    if (save) R.store.set(key, l);
    try { d.dispatchEvent(new CustomEvent('__P__:lang', { detail: l })); } catch (e) { /* old engines */ }
  }
  d.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-set-lang]') : null;
    if (b) apply(find(b.getAttribute('data-set-lang')), true);
  });
  d.addEventListener('change', function (e) {
    var s = e.target;
    if (s && s.matches && s.matches('select[data-set-lang]')) apply(find(s.value), true);
  });
  apply(detect(), false);
  // In-page links such as <a href="#lang=ru"> switch the language too.
  try {
    window.addEventListener('hashchange', function () {
      var m = /[#&]lang=([A-Za-z0-9_-]+)/.exec(location.hash);
      var x = m && best(m[1]);
      if (x) apply(x, true);
    });
  } catch (e) { /* no window events */ }
}

function rtTheme(R) {
  var h = document.documentElement;
  var c = R.cfg || {};
  var key = '__P__-scheme:' + (c.id || '');
  function sysDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }
  function sys() {
    if (c.scheme === 'dark') return 'dark';
    if (c.scheme === 'auto' && sysDark()) return 'dark';
    return 'light';
  }
  function cur() { return h.getAttribute('data-scheme') || sys(); }
  // Browser chrome colour follows the page background of the active scheme.
  function tint() {
    var m = document.querySelector('meta[name="theme-color"]');
    var root = document.querySelector('.__P__-root');
    if (!m || !root) return;
    try {
      var bg = getComputedStyle(root).backgroundColor;
      // A transparent root would paint the browser chrome black; keep the static value then.
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) m.setAttribute('content', bg);
    } catch (e) { /* ignore */ }
  }
  function sync() {
    var s = cur();
    R.$$('[data-__P__-scheme]').forEach(function (b) { b.setAttribute('aria-pressed', s === 'dark' ? 'true' : 'false'); });
    tint();
  }
  // No data-scheme attribute = follow the document setting / system; only an explicit toggle pins a scheme (the product CSS keys on
  // html[data-scheme]; without it the theme stays whatever the static CSS chose).
  var saved = R.store.get(key);
  if (saved === 'dark' || saved === 'light') h.setAttribute('data-scheme', saved);
  sync();
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-__P__-scheme]') : null;
    if (!b) return;
    var s = cur() === 'dark' ? 'light' : 'dark';
    h.setAttribute('data-scheme', s);
    R.store.set(key, s);
    sync();
  });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  } catch (e) { /* no matchMedia listeners */ }
}

export {
  rtBlob,
  rtI18n,
  rtTheme
};
