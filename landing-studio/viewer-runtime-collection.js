// landing-studio/viewer-runtime-collection.js - runtime features of the collection block (serialized with
// Function.prototype.toString like viewer-runtime.js): `collection` (search, facet / range filters, sorting, paging,
// item details dialog) and `reader` (audio player with chapters, docked mini player, position memory and speed; text /
// Markdown reader with font size, light / sepia / dark and remembered position; PDF / video / image viewers), and
// their CSS. Rules of viewer-runtime.js apply: each function references only R, its locals and browser globals, is
// ES5-ish and strict-mode safe, carries no UI text (R.t with keys recorded by the block), and avoids the minifier
// traps (no division right after '}', no HTML comment tokens, no of / await / yield before '/').

/* ---------- collection ---------- */

// Every [data-lp-cl] block: [data-lp-ci] items of [data-lp-cl-list] are filtered by the search box [data-lp-cl-q]
// (all words, folded like the exported data-lp-q text), facet options [data-lp-cl-fo="<facet>:<option>"] (checkboxes or
// aria-pressed chips; OR inside a facet, AND across facets, matched against data-lp-f tokens), ranges
// [data-lp-cl-min|max="r<i>"] (data-lp-v numbers) and sorted by [data-lp-cl-sort] ('<key>:a|d' on data-lp-v values;
// missing values last; document order breaks ties). data-lp-cl-more pages the result. Without JavaScript every item
// stays visible. [data-lp-det-open] opens the item's [data-lp-det] details in a dialog (a copy; the original <details>
// remains the no-JS fallback).
function rtCollection(R) {
  var d = document;
  var hop = Object.prototype.hasOwnProperty;
  // Search folding: NFD splits letters from combining marks (U+0300..U+036F), which are then removed, so 'cafe' finds
  // 'café'. Must match the exporter's folding of data-lp-q exactly, or matches silently disappear.
  function fold(s) {
    s = String(s || '');
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize */ }
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  // Per-language value ({lang: text}) for the current language.
  function lv(v) {
    if (!v || typeof v !== 'object') return v;
    var l = R.lang();
    if (hop.call(v, l)) return v[l];
    if (hop.call(v, R.cfg.defaultLang)) return v[R.cfg.defaultLang];
    for (var k in v) if (hop.call(v, k)) return v[k];
    return '';
  }
  // Collator cached per language: constructing Intl.Collator is costly and sorting calls compare O(n log n) times.
  var coll = null;
  var collLang = '';
  function compare(a, b) {
    var l = R.lang();
    if (!coll || collLang !== l) {
      collLang = l;
      try { coll = new Intl.Collator(l, { numeric: true, sensitivity: 'base' }).compare; } catch (e) { coll = function (x, y) { return x < y ? -1 : x > y ? 1 : 0; }; }
    }
    return coll(a, b);
  }
  function relabel(root) {
    R.$$('option[data-lp-l]', root).forEach(function (o) {
      var m = null;
      try { m = JSON.parse(o.getAttribute('data-lp-l')); } catch (e) { m = null; }
      var t = m ? lv(m) : '';
      if (t) o.textContent = t;
    });
  }

  function setup(root) {
    var list = R.$('[data-lp-cl-list]', root);
    if (!list) return;
    var items = [];
    for (var c = list.firstElementChild; c; c = c.nextElementSibling) if (c.hasAttribute('data-lp-ci')) items.push(c);
    var data = items.map(function (el, i) {
      var v = {};
      try { v = JSON.parse(el.getAttribute('data-lp-v') || '{}') || {}; } catch (e) { v = {}; }
      return { el: el, i: i, q: el.getAttribute('data-lp-q') || '', f: ' ' + (el.getAttribute('data-lp-f') || '') + ' ', v: v };
    });
    var total = data.length;
    var q = R.$('[data-lp-cl-q]', root);
    var sel = R.$('[data-lp-cl-sort]', root);
    var count = R.$('[data-lp-cl-count]', root);
    var empty = R.$('[data-lp-cl-empty]', root);
    var more = R.$('[data-lp-cl-morebtn]', root);
    var page = Number(root.getAttribute('data-lp-cl-more')) || 0;
    var shown = page;
    var hero = root.getAttribute('data-lp-cl-v') === 'feature';
    var lastSort = '';
    var lastLang = '';
    var timer = 0;

    function isOn(x) { return x.tagName === 'INPUT' ? x.checked : x.getAttribute('aria-pressed') === 'true'; }
    function groups() {
      var g = {};
      R.$$('[data-lp-cl-fo]', root).forEach(function (x) {
        if (!isOn(x)) return;
        var t = x.getAttribute('data-lp-cl-fo');
        var fi = t.split(':')[0];
        (g[fi] = g[fi] || []).push(t);
      });
      return g;
    }
    function bounds() {
      var out = {};
      R.$$('[data-lp-cl-min],[data-lp-cl-max]', root).forEach(function (inp) {
        var lo = inp.hasAttribute('data-lp-cl-min');
        var k = inp.getAttribute(lo ? 'data-lp-cl-min' : 'data-lp-cl-max');
        var raw = String(inp.value || '').replace(/\s+/g, '').replace(',', '.');
        if (!raw) return;
        var n = Number(raw);
        if (!isFinite(n)) return;
        var b = out[k] || (out[k] = {});
        if (lo) b.min = n; else b.max = n;
      });
      return out;
    }
    function match(x, terms, g, rng) {
      var i;
      for (i = 0; i < terms.length; i++) if (x.q.indexOf(terms[i]) < 0) return false;
      for (var fi in g) {
        if (!hop.call(g, fi)) continue;
        var any = false;
        for (i = 0; i < g[fi].length; i++) if (x.f.indexOf(' ' + g[fi][i] + ' ') >= 0) { any = true; break; }
        if (!any) return false;
      }
      for (var k in rng) {
        if (!hop.call(rng, k)) continue;
        var v = x.v[k];
        if (typeof v !== 'number') return false;
        if (rng[k].min != null && v < rng[k].min) return false;
        if (rng[k].max != null && v > rng[k].max) return false;
      }
      return true;
    }
    function order(key, dir) {
      var arr = data.slice();
      if (!key) return arr;
      arr.sort(function (a, b) {
        var x = lv(a.v[key]);
        var y = lv(b.v[key]);
        var nx = x == null || x === '';
        var ny = y == null || y === '';
        if (nx || ny) return nx === ny ? a.i - b.i : nx ? 1 : -1;
        var r = typeof x === 'number' && typeof y === 'number' ? x - y : compare(String(x), String(y));
        if (!r) return a.i - b.i;
        return dir === 'd' ? -r : r;
      });
      return arr;
    }
    var sorted = data.slice();
    function apply(keepPage) {
      var terms = q ? fold(q.value).split(' ').filter(Boolean) : [];
      var g = groups();
      var rng = bounds();
      var active = terms.length > 0 || Object.keys(g).length > 0 || Object.keys(rng).length > 0;
      var sv = sel ? sel.value : '';
      var l = R.lang();
      if (sv !== lastSort || (sv && l !== lastLang)) {
        var p = sv.split(':');
        sorted = order(p[0], p[1]);
        // Moving a focused node would drop focus: remember it and give it back.
        var f = d.activeElement;
        var frag = d.createDocumentFragment();
        sorted.forEach(function (x) { frag.appendChild(x.el); });
        list.appendChild(frag);
        if (f && f !== d.activeElement && list.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
        lastSort = sv;
        lastLang = l;
      }
      if (!keepPage) shown = page;
      var n = 0;
      var vis = 0;
      var first = true;
      sorted.forEach(function (x) {
        var ok = match(x, terms, g, rng);
        if (ok) n++;
        var show = ok && (!page || n <= shown);
        x.el.hidden = !show;
        if (show) vis++;
        if (hero) {
          var h = first && show;
          if (h) first = false;
          if (h) x.el.classList.add('lp-cl-hero'); else x.el.classList.remove('lp-cl-hero');
        }
      });
      if (count) count.textContent = active ? R.t('col.countOf', { n: n, total: total }) : R.t('col.count', { n: total });
      if (empty) empty.hidden = n > 0;
      R.$$('[data-lp-cl-reset]', root).forEach(function (b) { if (!empty || !empty.contains(b)) b.hidden = !active; });
      if (more) {
        var left = n - vis;
        more.hidden = left <= 0;
        if (left > 0) more.textContent = R.t('col.more', { n: left });
      }
      R.$$('[data-lp-cl-dd]', root).forEach(function (dd) {
        var k = R.$$('[data-lp-cl-fo]', dd).filter(isOn).length;
        R.$$('[data-lp-cl-min],[data-lp-cl-max]', dd).forEach(function (inp) { if (String(inp.value || '').trim()) k = Math.max(k, 1); });
        var badge = R.$('[data-lp-cl-n]', dd);
        if (badge) { badge.textContent = k ? String(k) : ''; badge.hidden = !k; }
        var pill = R.$('summary', dd);
        if (pill) { if (k) pill.classList.add('lp-on'); else pill.classList.remove('lp-on'); }
      });
    }
    function later() {
      clearTimeout(timer);
      timer = setTimeout(function () { apply(false); }, 180);
    }
    function reset() {
      if (q) q.value = '';
      R.$$('[data-lp-cl-fo]', root).forEach(function (x) {
        if (x.tagName === 'INPUT') x.checked = false; else x.setAttribute('aria-pressed', 'false');
      });
      R.$$('[data-lp-cl-min],[data-lp-cl-max]', root).forEach(function (inp) { inp.value = ''; });
      apply(false);
    }
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t === q) later();
      else if (t.hasAttribute && (t.hasAttribute('data-lp-cl-min') || t.hasAttribute('data-lp-cl-max'))) later();
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t === sel || (t.hasAttribute && t.hasAttribute('data-lp-cl-fo'))) apply(false);
    });
    root.addEventListener('keydown', function (e) {
      if (e.target === q && e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); apply(false); }
    });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var b = t.closest('button[data-lp-cl-fo]');
      if (b) {
        b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        apply(false);
        return;
      }
      if (t.closest('[data-lp-cl-reset]')) {
        reset();
        try { (q || R.$('[data-lp-cl-fo],[data-lp-cl-sort]', root) || root).focus({ preventScroll: true }); } catch (x) { /* ignore */ }
        return;
      }
      if (t.closest('[data-lp-cl-morebtn]')) {
        var before = sorted.filter(function (x) { return !x.el.hidden; }).length;
        shown += page;
        apply(true);
        var next = sorted.filter(function (x) { return !x.el.hidden; })[before];
        if (next) {
          if (!next.el.hasAttribute('tabindex')) next.el.setAttribute('tabindex', '-1');
          try { next.el.focus({ preventScroll: false }); } catch (x2) { /* ignore */ }
        }
      }
    });
    // Drop-down filters: one open at a time; outside click and Escape close them.
    R.$$('[data-lp-cl-dd]', root).forEach(function (dd) {
      dd.addEventListener('toggle', function () {
        if (!dd.open) return;
        R.$$('details[data-lp-cl-dd][open]').forEach(function (o) { if (o !== dd) o.open = false; });
      });
      dd.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.key === 'Esc') && dd.open) {
          e.preventDefault();
          e.stopPropagation();
          dd.open = false;
          var s = R.$('summary', dd);
          if (s) s.focus();
        }
      });
    });
    R.on('lp:lang', function () { relabel(root); apply(true); });
    relabel(root);
    apply(false);
  }
  R.$$('[data-lp-cl]').forEach(setup);
  d.addEventListener('click', function (e) {
    var t = e.target;
    R.$$('details[data-lp-cl-dd][open]').forEach(function (o) { if (!o.contains(t)) o.open = false; });
  });

  // Item details dialog: cover, title, subtitle, date, tags, price / buy and actions of the card + the details body.
  var M = null;
  function strip(el) {
    R.$$('[id]', el).forEach(function (x) { x.removeAttribute('id'); });
    R.$$('[data-lp-zoom]', el).forEach(function (x) { x.removeAttribute('data-lp-zoom'); x.removeAttribute('role'); x.removeAttribute('tabindex'); });
    return el;
  }
  function copy(src, cls) {
    if (!src) return null;
    var c2 = strip(src.cloneNode(true));
    if (cls) c2.className += ' ' + cls;
    return c2;
  }
  function details(btn) {
    var item = btn.closest('[data-lp-ci]');
    var body = item ? R.$('[data-lp-det]', item) : null;
    if (!body || M) return;
    var box = R.el('div', 'lp-cdm lp-ovl');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'lp-cdm-t');
    var panel = R.el('div', 'lp-cdm-panel');
    var img = R.$('.lp-cl-cv img,.lp-cl-thumb img', item);
    var nocv = img ? null : R.$('.lp-cl-cv .lp-cl-nocv', item);
    if (img || nocv) {
      var cv = R.el('div', 'lp-cdm-cv');
      cv.appendChild(copy(img || nocv));
      panel.appendChild(cv);
    } else panel.className += ' lp-cdm-nocv';
    var main = R.el('div', 'lp-cdm-main');
    var t = R.el('h2', 'lp-cdm-t');
    t.id = 'lp-cdm-t';
    var tt = R.$('.lp-cl-title', item);
    if (tt) { var tc = strip(tt.cloneNode(true)); while (tc.firstChild) t.appendChild(tc.firstChild); }
    var x = R.el('button', 'lp-cdm-x');
    x.type = 'button';
    x.setAttribute('aria-label', R.t('dlgClose'));
    var g = R.el('span', '', '×');
    g.setAttribute('aria-hidden', 'true');
    x.appendChild(g);
    ['.lp-cl-badge', '.lp-cl-meta'].forEach(function (s) { var e = copy(R.$(s, item)); if (e) main.appendChild(e); });
    main.appendChild(t);
    ['.lp-cl-sub', '.lp-cl-tags', '.lp-cl-foot'].forEach(function (s) { var e = copy(R.$(s, item)); if (e) main.appendChild(e); });
    var acts = copy(R.$('.lp-cl-acts', item));
    if (acts) {
      R.$$('[data-lp-det-open]', acts).forEach(function (b) { b.parentNode.removeChild(b); });
      if (acts.children.length) main.appendChild(acts);
    }
    main.appendChild(copy(body, 'lp-cdm-body'));
    panel.appendChild(main);
    panel.appendChild(x);
    box.appendChild(panel);
    box.lpItem = item;
    x.addEventListener('click', function () { if (M) M.close(); });
    box.addEventListener('click', function (e) { if (e.target === box && M) M.close(); });
    d.body.appendChild(box);
    M = R.modal ? R.modal(box, {
      opener: btn,
      initial: x,
      onClose: function () { if (box.parentNode) box.parentNode.removeChild(box); M = null; },
    }) : null;
  }
  d.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-lp-det-open]') : null;
    if (!b) return;
    e.preventDefault();
    details(b);
  });
  R.on('lp:lang', function () {
    var x = d.querySelector('.lp-cdm-x');
    if (x) x.setAttribute('aria-label', R.t('dlgClose'));
  });
}

/* ---------- reader ---------- */

// [data-lp-read="<attId>"][data-lp-rk="audio|video|text|pdf|image"] opens the file of a collection item:
// - audio: player dialog; the item's [data-lp-file][data-lp-rk=audio] rows form the chapter list (document order);
//   play / pause, previous / next chapter, ±15 s, seek, speed, auto-advance; closing the dialog while it plays docks a
//   mini player; the position per item (chapter + time) is kept in lp-pos:<docId> and resumed by the item's buttons;
// - text: plain text or Markdown (a small DOM renderer: nothing is parsed as HTML) with font size, light / sepia /
//   dark and the scroll position remembered per file; - pdf: <object> with fallback, open and download;
// - video: native player with speed and remembered position; - image: the picture.
// Prefs (font size, page colours, speed) in lp-reader:<docId>. Downloads go through [data-att-dl] (feature embed).
function rtReader(R) {
  var d = document;
  var c = R.cfg || {};
  var hop = Object.prototype.hasOwnProperty;
  var POS = 'lp-pos:' + (c.id || '');
  var PREF = 'lp-reader:' + (c.id || '');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var IC = {
    play: 'M8 5.2v13.6L18.6 12z', pause: 'M7 5h3.6v14H7z M13.4 5H17v14h-3.6z', prev: 'M6.5 5v14 M18.5 5.5v13L9 12z',
    next: 'M17.5 5v14 M5.5 5.5v13L15 12z', back: 'M4.6 12a7.4 7.4 0 1 0 2.2-5.2 M4.6 4.4v4h4', fwd: 'M19.4 12a7.4 7.4 0 1 1-2.2-5.2 M19.4 4.4v4h-4',
    dl: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19.5h14', open: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  };
  // Discrete font sizes (px) and speeds: fixed steps restore exactly from stored prefs and are validated by membership
  // (indexOf), so a corrupted preference falls back to the default instead of producing odd values.
  var SIZES = [15, 16.5, 18, 19.5, 21, 23, 25.5, 28];
  var RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var THEMES = ['light', 'sepia', 'dark'];

  function load(k) {
    var v = null;
    try { v = JSON.parse(R.store.get(k) || 'null'); } catch (e) { v = null; }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  var prefs = load(PREF);
  function pref(k, def, ok) { return hop.call(prefs, k) && ok(prefs[k]) ? prefs[k] : def; }
  function setPref(k, v) { prefs[k] = v; R.store.set(PREF, JSON.stringify(prefs)); }
  function getPos(k) { var m = load(POS); return hop.call(m, k) && m[k] && typeof m[k] === 'object' ? m[k] : null; }
  // Reading positions per item, capped at 300 entries with least-recently-updated eviction, so localStorage (about
  // 5 MB per origin, shared by the whole site) cannot fill up over years of use.
  function setPos(k, v) {
    var m = load(POS);
    if (v == null) delete m[k];
    else { v.u = Date.now(); m[k] = v; }
    var keys = Object.keys(m);
    if (keys.length > 300) {
      keys.sort(function (a, b) { return ((m[a] && m[a].u) || 0) - ((m[b] && m[b].u) || 0); });
      for (var i = 0; i < keys.length - 300; i++) delete m[keys[i]];
    }
    R.store.set(POS, JSON.stringify(m));
  }
  function base(id) { return String(R.meta(id).mime || '').split(';')[0].replace(/\s+/g, '').toLowerCase(); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(s) {
    s = isFinite(s) && s > 0 ? Math.floor(s) : 0;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + p2(m) : String(m)) + ':' + p2(s % 60);
  }
  function svg(name) {
    var s = d.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'lp-ic');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var p = d.createElementNS(SVGNS, 'path');
    p.setAttribute('d', IC[name] || '');
    s.appendChild(p);
    return s;
  }
  // Labels re-applied on a language switch: [element, attribute | '' (text), key, vars-function].
  var labels = [];
  function lab(el, attr, key, vars) {
    labels.push([el, attr, key, vars]);
    var v = R.t(key, vars ? vars() : undefined);
    if (attr) el.setAttribute(attr, v); else el.textContent = v;
    return el;
  }
  function relabel() {
    labels = labels.filter(function (x) { return d.contains(x[0]); });
    labels.forEach(function (x) {
      var v = R.t(x[2], x[3] ? x[3]() : undefined);
      if (x[1]) x[0].setAttribute(x[1], v); else x[0].textContent = v;
    });
  }
  R.on('lp:lang', function () { relabel(); if (P) sync(); });
  // Decimal separator of the current language (speed labels such as 1,5×).
  function dec() {
    try { return (1.5).toLocaleString(R.lang()).charAt(1) || '.'; } catch (e) { return '.'; }
  }
  function button(cls, ic, key) {
    var b = R.el('button', cls);
    b.type = 'button';
    if (ic) b.appendChild(svg(ic));
    if (key) lab(b, 'aria-label', key);
    return b;
  }
  function dlButton(id, cls) {
    var b = button(cls || 'lp-rd-b', 'dl', 'download');
    b.setAttribute('data-att-dl', '');
    b.setAttribute('data-att', id);
    lab(b, 'title', 'download');
    return b;
  }
  function kids(src, dst) {
    if (!src) return;
    var cl = src.cloneNode(true);
    R.$$('[id]', cl).forEach(function (x) { x.removeAttribute('id'); });
    while (cl.firstChild) dst.appendChild(cl.firstChild);
  }
  function itemOf(b) {
    var it = b.closest('[data-lp-ci]');
    if (it) return it;
    var dlg = b.closest('.lp-cdm');
    return dlg && dlg.lpItem ? dlg.lpItem : null;
  }
  function rowOf(item, id) {
    var rows = item ? R.$$('[data-lp-file]', item) : [];
    for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-lp-file') === id) return rows[i];
    return null;
  }
  function keyOf(item, id) { return (item && item.getAttribute('data-lp-iid')) || id; }
  function fileLabel(item, id, dst) {
    var row = rowOf(item, id);
    var l = row && R.$('.lp-cl-fl', row);
    if (l) kids(l, dst); else dst.textContent = R.meta(id).name;
  }
  function titleOf(item, id, dst) {
    var t = item && R.$('.lp-cl-title', item);
    if (t) kids(t, dst); else dst.textContent = R.meta(id).name;
  }

  /* dialog shell */
  var M = null;
  var cur = null;
  function shell(kind, item, id, opener) {
    var box = R.el('div', 'lp-rd lp-ovl lp-rd-' + kind);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'lp-rd-t');
    var panel = R.el('div', 'lp-rd-panel');
    var head = R.el('div', 'lp-rd-head');
    var tt = R.el('div', 'lp-rd-tt');
    var t = R.el('h2', 'lp-rd-t');
    t.id = 'lp-rd-t';
    titleOf(item, id, t);
    var sub = R.el('p', 'lp-rd-sub');
    tt.appendChild(t);
    tt.appendChild(sub);
    var tools = R.el('div', 'lp-rd-tools');
    var x = button('lp-rd-x', '', 'dlgClose');
    var g = R.el('span', '', '×');
    g.setAttribute('aria-hidden', 'true');
    x.appendChild(g);
    head.appendChild(tt);
    head.appendChild(tools);
    head.appendChild(x);
    var body = R.el('div', 'lp-rd-body');
    panel.appendChild(head);
    panel.appendChild(body);
    box.appendChild(panel);
    var S = { kind: kind, box: box, sub: sub, tools: tools, body: body, x: x, item: item, id: id, onClose: null };
    x.addEventListener('click', function () { if (M) M.close(); });
    box.addEventListener('click', function (e) { if (e.target === box && M) M.close(); });
    d.body.appendChild(box);
    cur = S;
    M = R.modal ? R.modal(box, {
      opener: opener,
      initial: x,
      onClose: function () {
        try { if (S.onClose) S.onClose(); } catch (e) { /* keep closing */ }
        if (box.parentNode) box.parentNode.removeChild(box);
        M = null;
        cur = null;
      },
    }) : { close: function () { if (S.onClose) S.onClose(); if (box.parentNode) box.parentNode.removeChild(box); M = null; cur = null; } };
    return S;
  }
  function wait(S) {
    var w = R.el('p', 'lp-rd-wait');
    lab(w, '', 'rd.loading');
    S.body.appendChild(w);
    return w;
  }
  function failed(S, id) {
    S.body.textContent = '';
    var fb = R.el('div', 'lp-rd-fb');
    fb.appendChild(lab(R.el('p', ''), '', 'rd.failed'));
    var b = R.el('button', 'lp-btn lp-btn-primary');
    b.type = 'button';
    b.setAttribute('data-att-dl', '');
    b.setAttribute('data-att', id);
    b.appendChild(svg('dl'));
    b.appendChild(lab(R.el('span', ''), '', 'download'));
    fb.appendChild(b);
    S.body.appendChild(fb);
  }
  function speedSelect(media, key) {
    var w = R.el('label', 'lp-rd-speed');
    var s = R.el('span', '');
    lab(s, '', 'rd.speed');
    var sel = R.el('select', '');
    var r0 = pref('rate', 1, function (v) { return RATES.indexOf(v) >= 0; });
    RATES.forEach(function (r) {
      var o = R.el('option', '', String(r).replace('.', dec()) + '×');
      o.value = String(r);
      if (r === r0) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var r = Number(sel.value) || 1;
      setPref('rate', r);
      try { media().defaultPlaybackRate = r; media().playbackRate = r; } catch (e) { /* ignore */ }
    });
    w.appendChild(s);
    w.appendChild(sel);
    return w;
  }
  function rate() { return pref('rate', 1, function (v) { return RATES.indexOf(v) >= 0; }); }

  /* audio: one element for the page (keeps playing in the dock) */
  var A = null;
  var P = null; // { item, key, files: [{id}], idx, seek, src }
  var U = null; // controls of the open player dialog
  var dock = null;
  var lastSave = 0;
  // Position of the current chapter (only while the element really plays that chapter's URL).
  function save() {
    if (!A || !P || !P.files[P.idx] || !P.src || A.src !== P.src || A.ended) return;
    setPos(P.key, { a: P.files[P.idx].id, t: Math.round(A.currentTime || 0) });
  }
  function audio() {
    if (A) return A;
    A = new Audio();
    A.preload = 'metadata';
    A.addEventListener('loadedmetadata', function () {
      if (P && P.seek) {
        try { A.currentTime = Math.min(P.seek, Math.max(0, (A.duration || P.seek) - 1)); } catch (e) { /* ignore */ }
        R.live(R.t('rd.resumed', { time: clock(P.seek) }));
        P.seek = 0;
      }
      sync();
    });
    A.addEventListener('timeupdate', function () {
      tick();
      var now = Date.now();
      if (now - lastSave > 5000) { lastSave = now; save(); }
    });
    ['play', 'pause', 'durationchange', 'ratechange'].forEach(function (ev) { A.addEventListener(ev, sync); });
    A.addEventListener('pause', save);
    A.addEventListener('ended', function () {
      if (P && P.idx < P.files.length - 1) track(P.idx + 1, 0, true);
      else { if (P) setPos(P.key, null); sync(); }
    });
    A.addEventListener('error', function () { if (U) U.note.hidden = false; });
    return A;
  }
  function play() {
    try { var pr = A.play(); if (pr && pr.catch) pr.catch(function () { sync(); }); } catch (e) { /* needs a gesture */ }
  }
  function track(i, t, go) {
    var a = audio();
    P.idx = i;
    P.seek = t > 3 ? t - 2 : 0;
    var f = P.files[i];
    if (U) U.note.hidden = true;
    R.url(f.id).then(function (u) {
      if (!P || P.files[P.idx] !== f) return;
      a.src = u;
      P.src = a.src;
      a.defaultPlaybackRate = rate();
      a.playbackRate = rate();
      if (go) play();
      meta();
    }).catch(function () { if (U) U.note.hidden = false; });
    sync();
  }
  function meta() {
    if (!P || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      var t = R.el('span', '');
      titleOf(P.item, P.files[P.idx].id, t);
      var ch = R.el('span', '');
      fileLabel(P.item, P.files[P.idx].id, ch);
      var img = P.item && R.$('.lp-cl-cv img,.lp-cl-thumb img', P.item);
      var o = { title: (ch.textContent || '').trim(), album: (t.textContent || '').trim() };
      if (img && img.src) o.artwork = [{ src: img.currentSrc || img.src }];
      navigator.mediaSession.metadata = new MediaMetadata(o);
      navigator.mediaSession.setActionHandler('previoustrack', function () { if (P && P.idx > 0) track(P.idx - 1, 0, true); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { if (P && P.idx < P.files.length - 1) track(P.idx + 1, 0, true); });
    } catch (e) { /* optional API */ }
  }
  function tick() {
    var cur2 = A ? A.currentTime || 0 : 0;
    var dur = A && isFinite(A.duration) ? A.duration : 0;
    if (U) {
      if (!U.drag) { U.seek.max = String(Math.max(1, Math.floor(dur))); U.seek.value = String(Math.floor(cur2)); }
      U.seek.setAttribute('aria-valuetext', clock(cur2) + ' / ' + clock(dur));
      U.cur.textContent = clock(cur2);
      U.dur.textContent = dur ? clock(dur) : '';
    }
    if (dock) dock.bar.style.width = dur ? Math.min(100, (cur2 * 100) / dur) + '%' : '0';
  }
  function sync() {
    var on = !!(A && !A.paused && !A.ended);
    var n = P ? P.files.length : 0;
    [U && U.pp, dock && dock.pp].forEach(function (b) {
      if (!b) return;
      b.textContent = '';
      b.appendChild(svg(on ? 'pause' : 'play'));
      b.setAttribute('aria-label', R.t(on ? 'rd.pause' : 'rd.play'));
      b.setAttribute('data-k', on ? 'rd.pause' : 'rd.play');
    });
    if (U) {
      U.prev.disabled = !P || P.idx <= 0;
      U.next.disabled = !P || P.idx >= n - 1;
      U.chs.forEach(function (b, i) { b.setAttribute('aria-current', P && i === P.idx ? 'true' : 'false'); });
      chapterText(U.sub);
      // The download button follows the current chapter.
      if (P && U.dl) U.dl.setAttribute('data-att', P.files[P.idx].id);
    }
    if (dock) chapterText(dock.b);
    tick();
  }
  function chapterText(el) {
    if (!el || !P) return;
    el.textContent = '';
    if (P.files.length > 1) el.appendChild(d.createTextNode(R.t('rd.chapter', { n: P.idx + 1, total: P.files.length }) + ' · '));
    var s = R.el('span', '');
    fileLabel(P.item, P.files[P.idx].id, s);
    el.appendChild(s);
  }
  function toggle() {
    audio();
    if (!A.src) { track(P.idx, 0, true); return; }
    if (A.paused) play(); else A.pause();
  }
  function skip(s) {
    if (!A || !A.src) return;
    try { A.currentTime = Math.max(0, Math.min((A.duration || 0) - 0.5, A.currentTime + s)); } catch (e) { /* ignore */ }
  }
  function openAudio(item, id, opener) {
    var rows = item ? R.$$('[data-lp-file][data-lp-rk="audio"]', item) : [];
    var files = rows.map(function (r) { return { id: r.getAttribute('data-lp-file') }; });
    var at = -1;
    files.forEach(function (f, i) { if (at < 0 && f.id === id) at = i; });
    if (at < 0) { files = [{ id: id }]; at = 0; }
    var key = keyOf(item, id);
    var chapter = !!opener.closest('[data-lp-file]');
    if (!P || P.key !== key) {
      if (A) { save(); A.pause(); }
      P = { item: item, key: key, files: files, idx: at, seek: 0, src: '' };
      var saved = getPos(key);
      var si = -1;
      if (saved) files.forEach(function (f, i) { if (f.id === saved.a) si = i; });
      if (saved && si >= 0 && (!chapter || si === at)) track(si, Number(saved.t) || 0, true);
      else track(at, 0, true);
    } else if (chapter && at !== P.idx) track(at, 0, true);
    else if (A && A.paused) play();
    playerDialog(opener);
  }
  function playerDialog(opener) {
    if (dock) dock.box.hidden = true;
    var S = shell('audio', P.item, P.files[P.idx].id, opener);
    var wrap = R.el('div', 'lp-rd-player');
    var art = R.el('div', 'lp-rd-art');
    var img = P.item && R.$('.lp-cl-cv img,.lp-cl-thumb img', P.item);
    if (img) { var ci = img.cloneNode(false); ci.removeAttribute('data-lp-zoom'); ci.removeAttribute('role'); ci.removeAttribute('tabindex'); ci.alt = ''; art.appendChild(ci); } else art.appendChild(svg('music'));
    var main = R.el('div', 'lp-rd-main');
    var row = R.el('div', 'lp-rd-seekrow');
    var cur2 = R.el('span', 'lp-rd-cur', '0:00');
    var seek = R.el('input', 'lp-rd-seek');
    seek.type = 'range';
    seek.min = '0';
    seek.max = '1';
    seek.step = '1';
    seek.value = '0';
    lab(seek, 'aria-label', 'rd.seek');
    var dur = R.el('span', 'lp-rd-dur', '');
    row.appendChild(cur2);
    row.appendChild(seek);
    row.appendChild(dur);
    var ctr = R.el('div', 'lp-rd-ctrls');
    var prev = button('lp-rd-c', 'prev', 'rd.prev');
    var back = button('lp-rd-c', 'back', 'rd.back');
    var pp = button('lp-rd-c lp-rd-pp', 'play', '');
    var fwd = button('lp-rd-c', 'fwd', 'rd.fwd');
    var next = button('lp-rd-c', 'next', 'rd.next');
    [prev, back, pp, fwd, next].forEach(function (b) { ctr.appendChild(b); });
    var opts = R.el('div', 'lp-rd-opts');
    opts.appendChild(speedSelect(function () { return audio(); }));
    opts.appendChild(dlButton(P.files[P.idx].id));
    var note = R.el('p', 'lp-rd-note');
    lab(note, '', 'rd.failed');
    note.hidden = true;
    main.appendChild(row);
    main.appendChild(ctr);
    main.appendChild(opts);
    main.appendChild(note);
    wrap.appendChild(art);
    wrap.appendChild(main);
    S.body.appendChild(wrap);
    var chs = [];
    if (P.files.length > 1) {
      var sec = R.el('div', 'lp-rd-chap');
      sec.appendChild(lab(R.el('h3', ''), '', 'rd.chapters'));
      var ol = R.el('ol', 'lp-rd-list');
      P.files.forEach(function (f, i) {
        var li = R.el('li', '');
        var b = R.el('button', 'lp-rd-ch');
        b.type = 'button';
        b.appendChild(R.el('span', 'lp-rd-n', String(i + 1)));
        var l = R.el('span', 'lp-rd-cl');
        fileLabel(P.item, f.id, l);
        b.appendChild(l);
        b.addEventListener('click', function () { track(i, 0, true); });
        li.appendChild(b);
        ol.appendChild(li);
        chs.push(b);
      });
      sec.appendChild(ol);
      S.body.appendChild(sec);
    }
    U = { pp: pp, prev: prev, next: next, seek: seek, cur: cur2, dur: dur, chs: chs, sub: S.sub, note: note, drag: false, dl: opts.lastChild };
    pp.addEventListener('click', toggle);
    prev.addEventListener('click', function () { if (P.idx > 0) track(P.idx - 1, 0, true); });
    next.addEventListener('click', function () { if (P.idx < P.files.length - 1) track(P.idx + 1, 0, true); });
    back.addEventListener('click', function () { skip(-15); });
    fwd.addEventListener('click', function () { skip(15); });
    seek.addEventListener('input', function () { U.drag = true; U.cur.textContent = clock(Number(seek.value)); });
    seek.addEventListener('change', function () {
      U.drag = false;
      if (A && A.src) { try { A.currentTime = Number(seek.value) || 0; } catch (e) { /* ignore */ } }
    });
    S.onClose = function () {
      U = null;
      save();
      if (A && A.src && !A.ended && (!A.paused || A.currentTime > 0)) showDock();
    };
    sync();
  }
  function showDock() {
    if (!dock) {
      var box = R.el('div', 'lp-dock lp-ovl');
      box.setAttribute('role', 'region');
      lab(box, 'aria-label', 'rd.now');
      var pp = button('lp-dock-pp', 'play', '');
      var t = R.el('button', 'lp-dock-t');
      t.type = 'button';
      lab(t, 'title', 'rd.open');
      var a = R.el('span', 'lp-dock-a');
      var b = R.el('span', 'lp-dock-b');
      t.appendChild(a);
      t.appendChild(b);
      var bar = R.el('span', 'lp-dock-bar');
      var fill = R.el('span', '');
      bar.appendChild(fill);
      var x = button('lp-dock-x', '', 'rd.stop');
      var g = R.el('span', '', '×');
      g.setAttribute('aria-hidden', 'true');
      x.appendChild(g);
      box.appendChild(pp);
      box.appendChild(t);
      box.appendChild(x);
      box.appendChild(bar);
      pp.addEventListener('click', toggle);
      t.addEventListener('click', function () { if (!M && P) playerDialog(t); });
      x.addEventListener('click', function () {
        if (A) A.pause();
        save();
        box.hidden = true;
      });
      d.body.appendChild(box);
      dock = { box: box, pp: pp, a: a, b: b, bar: fill };
    }
    if (d.querySelector('.lp-cartfab')) dock.box.classList.add('lp-dock-fab');
    dock.a.textContent = '';
    titleOf(P.item, P.files[P.idx].id, dock.a);
    dock.box.hidden = false;
    sync();
  }

  /* text reader */
  // Markdown in text files is untrusted (any attachment): links are limited to http(s), mailto and tel, so a
  // javascript: URL in a file can never become a clickable link.
  function safeHref(u) {
    u = String(u || '').trim();
    return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : '';
  }
  function el(tag, cls) { var e = d.createElement(tag); if (cls) e.className = cls; return e; }
  // Inline Markdown: code spans, links (http, mailto, tel), images as their alt text, autolinks, ** __ * _ ~~, escapes,
  // hard line breaks. Builds DOM nodes; text always goes through text nodes.
  function inline(s, parent) {
    var i = 0;
    var buf = '';
    var m;
    function flush() { if (buf) { parent.appendChild(d.createTextNode(buf)); buf = ''; } }
    function closeAt(run, from) {
      var k = from;
      while ((k = s.indexOf(run, k)) >= 0) {
        if (s.charAt(k - 1) !== ' ' && s.charAt(k - 1) !== '\\' && !(run.length === 1 && s.charAt(k + 1) === run)) return k;
        k += run.length;
      }
      return -1;
    }
    while (i < s.length) {
      var ch = s.charAt(i);
      var rest = s.slice(i);
      if (ch === '\\' && /^[\\`*_{}[\]()#+\-.!~|>]$/.test(s.charAt(i + 1))) { buf += s.charAt(i + 1); i += 2; continue; }
      if (ch === '\n') { flush(); parent.appendChild(el('br')); i++; continue; }
      if (ch === '`' && (m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
        flush();
        var code = el('code');
        code.textContent = m[2].replace(/^ | $/g, '');
        parent.appendChild(code);
        i += m[0].length;
        continue;
      }
      if (ch === '!' && (m = /^!\[([^\]]*)\]\([^)]*\)/.exec(rest))) { buf += m[1]; i += m[0].length; continue; }
      if (ch === '[' && (m = /^\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flush();
        var u = safeHref(m[2]);
        var a = el(u ? 'a' : 'span');
        if (u) { a.href = u; if (/^https?:/i.test(u)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } }
        inline(m[1], a);
        parent.appendChild(a);
        i += m[0].length;
        continue;
      }
      if (ch === '<' && (m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest))) {
        flush();
        var al = el('a');
        al.href = m[1];
        if (/^https?:/i.test(m[1])) { al.target = '_blank'; al.rel = 'noopener noreferrer'; }
        al.textContent = m[1].replace(/^mailto:/i, '');
        parent.appendChild(al);
        i += m[0].length;
        continue;
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        var run = /^(\*\*|__|~~|\*|_)/.exec(rest);
        run = run ? run[1] : '';
        var open = run && run !== '~' && !/\s/.test(s.charAt(i + run.length) || ' ') && !(ch === '_' && /[A-Za-z0-9]/.test(s.charAt(i - 1)));
        var j = open ? closeAt(run, i + run.length + 1) : -1;
        if (j > 0) {
          flush();
          var e2 = el(run === '~~' ? 'del' : run.length === 2 ? 'strong' : 'em');
          inline(s.slice(i + run.length, j), e2);
          parent.appendChild(e2);
          i = j + run.length;
          continue;
        }
      }
      buf += ch;
      i++;
    }
    flush();
  }
  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
  var RE_HEAD = /^ {0,3}(#{1,6})(?:\s+|$)(.*?)(?:\s+#+)?\s*$/;
  var RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  var RE_ITEM = /^(\s{0,3})([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
  var RE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  function cells(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var out = [];
    var cell = '';
    for (var i = 0; i < t.length; i++) {
      if (t.charAt(i) === '\\' && t.charAt(i + 1) === '|') { cell += '|'; i++; continue; }
      if (t.charAt(i) === '|') { out.push(cell.trim()); cell = ''; continue; }
      cell += t.charAt(i);
    }
    out.push(cell.trim());
    return out;
  }
  // Block Markdown → DOM (CommonMark core subset + GFM tables): headings (ATX / setext), paragraphs, block quotes,
  // nested lists, fenced / indented code, rules, tables.
  function blocks(lines, parent, depth) {
    var i = 0;
    var para = [];
    var m;
    function flush() {
      if (!para.length) return;
      var p = el('p');
      inline(para.join('\n').replace(/(?: {2,}|\\)\n/g, '\u0001').replace(/\n/g, ' ').replace(/\u0001/g, '\n'), p);
      parent.appendChild(p);
      para = [];
    }
    while (i < lines.length) {
      var ln = lines[i];
      if (!ln.trim()) { flush(); i++; continue; }
      if ((m = RE_FENCE.exec(ln))) {
        flush();
        var fence = m[1];
        var body = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) { body.push(lines[i]); i++; }
        i++;
        var pre = el('pre');
        var code = el('code');
        code.textContent = body.join('\n');
        pre.appendChild(code);
        parent.appendChild(pre);
        continue;
      }
      if (!para.length && /^( {4}|\t)/.test(ln)) {
        var ib = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) { ib.push(lines[i].replace(/^( {4}|\t)/, '')); i++; }
        while (ib.length && !ib[ib.length - 1].trim()) ib.pop();
        var pre2 = el('pre');
        var code2 = el('code');
        code2.textContent = ib.join('\n');
        pre2.appendChild(code2);
        parent.appendChild(pre2);
        continue;
      }
      if ((m = RE_HEAD.exec(ln))) { flush(); var h = el('h' + m[1].length); inline(m[2], h); parent.appendChild(h); i++; continue; }
      if (para.length && /^ {0,3}(=+|-+)\s*$/.test(ln)) {
        var hs = el(ln.trim().charAt(0) === '=' ? 'h1' : 'h2');
        inline(para.join(' '), hs);
        parent.appendChild(hs);
        para = [];
        i++;
        continue;
      }
      if (RE_HR.test(ln)) { flush(); parent.appendChild(el('hr')); i++; continue; }
      if (/^ {0,3}>/.test(ln)) {
        flush();
        var qb = [];
        while (i < lines.length && lines[i].trim() && (/^ {0,3}>/.test(lines[i]) || qb.length)) {
          if (!/^ {0,3}>/.test(lines[i]) && (RE_ITEM.test(lines[i]) || RE_HEAD.test(lines[i]))) break;
          qb.push(lines[i].replace(/^ {0,3}> ?/, ''));
          i++;
        }
        var bq = el('blockquote');
        if (depth < 12) blocks(qb, bq, depth + 1);
        parent.appendChild(bq);
        continue;
      }
      if (ln.indexOf('|') >= 0 && i + 1 < lines.length && RE_SEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush();
        var head = cells(ln);
        var al = cells(lines[i + 1]).map(function (x) { return /^:-+:$/.test(x) ? 'center' : /-+:$/.test(x) ? 'right' : ''; });
        i += 2;
        var wrapT = el('div', 'lp-rd-tbl');
        var tbl = el('table');
        var tr = el('tr');
        head.forEach(function (x, k) { var th = el('th'); if (al[k]) th.style.textAlign = al[k]; inline(x, th); tr.appendChild(th); });
        var thead = el('thead');
        thead.appendChild(tr);
        tbl.appendChild(thead);
        var tb = el('tbody');
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
          var r = cells(lines[i]);
          var row = el('tr');
          head.forEach(function (x, k) { var td = el('td'); if (al[k]) td.style.textAlign = al[k]; inline(r[k] || '', td); row.appendChild(td); });
          tb.appendChild(row);
          i++;
        }
        tbl.appendChild(tb);
        wrapT.appendChild(tbl);
        parent.appendChild(wrapT);
        continue;
      }
      if ((m = RE_ITEM.exec(ln)) && (m[4].trim() || !para.length)) {
        flush();
        var ordered = /\d/.test(m[2]);
        var list = el(ordered ? 'ol' : 'ul');
        if (ordered && parseInt(m[2], 10) !== 1) list.setAttribute('start', String(parseInt(m[2], 10)));
        var loose = false;
        while (i < lines.length) {
          var im = RE_ITEM.exec(lines[i]);
          if (!im || /\d/.test(im[2]) !== ordered) break;
          var pad = im[1].length + im[2].length + Math.min(4, Math.max(1, im[3].length));
          var lb = [im[4]];
          i++;
          while (i < lines.length) {
            var l2 = lines[i];
            if (!l2.trim()) {
              var nx = lines[i + 1] || '';
              if (nx.trim() && nx.search(/\S/) >= pad) { lb.push(''); loose = true; i++; continue; }
              break;
            }
            var ind = l2.search(/\S/);
            if (ind >= pad) { lb.push(l2.slice(pad)); i++; continue; }
            if (RE_ITEM.test(l2) || RE_HEAD.test(l2) || RE_HR.test(l2) || RE_FENCE.test(l2) || /^ {0,3}>/.test(l2)) break;
            lb.push(l2.trim());
            i++;
          }
          var li = el('li');
          if (depth < 12) blocks(lb, li, depth + 1);
          list.appendChild(li);
          if (i < lines.length && !lines[i].trim()) {
            var nn = lines[i + 1] || '';
            var nm = RE_ITEM.exec(nn);
            if (nm && /\d/.test(nm[2]) === ordered) { loose = true; i++; continue; }
            break;
          }
        }
        if (!loose) {
          R.$$('li', list).forEach(function (x) {
            var p = x.firstElementChild;
            if (p && p.tagName === 'P' && x.parentNode === list) {
              while (p.firstChild) x.insertBefore(p.firstChild, p);
              x.removeChild(p);
            }
          });
        }
        parent.appendChild(list);
        continue;
      }
      para.push(ln.replace(/^ {0,3}/, ''));
      i++;
    }
    flush();
  }
  // Plain text: paragraphs at blank lines; hard-wrapped prose (long lines) is joined, short lines (verse, lists) kept.
  function plain(text, parent) {
    text.split(/\n\s*\n+/).forEach(function (chunk) {
      var lines = chunk.replace(/^\n+|\s+$/g, '').split('\n');
      if (!lines.join('').trim()) return;
      var p = el('p');
      var avg = lines.reduce(function (n, l) { return n + l.length; }, 0) / lines.length;
      if (lines.length === 1 || avg > 55) p.textContent = lines.map(function (l) { return l.trim(); }).join(' ');
      else { p.className = 'lp-rd-lines'; p.textContent = lines.join('\n'); }
      parent.appendChild(p);
    });
  }
  function openText(item, id, opener) {
    var S = shell('text', item, id, opener);
    fileLabel(item, id, S.sub);
    var key = keyOf(item, id) + '/' + id;
    var fs = pref('fs', 3, function (v) { return v >= 0 && v < SIZES.length; });
    var th = pref('th', 'light', function (v) { return THEMES.indexOf(v) >= 0; });
    var page = el('div', 'lp-rd-page lp-rd-th-' + th);
    var doc = el('article', 'lp-rd-doc');
    doc.style.setProperty('--lp-rd-fs', SIZES[fs] + 'px');
    var prog = el('div', 'lp-rd-prog');
    var bar = el('span');
    prog.appendChild(bar);
    var pct = el('span', 'lp-rd-pct');
    var smaller = button('lp-rd-b', '', 'rd.smaller');
    smaller.appendChild(d.createTextNode('A−'));
    var larger = button('lp-rd-b lp-rd-big', '', 'rd.larger');
    larger.appendChild(d.createTextNode('A+'));
    var seg = el('div', 'lp-rd-seg');
    seg.setAttribute('role', 'group');
    lab(seg, 'aria-label', 'rd.theme');
    var thb = THEMES.map(function (k) {
      var b = R.el('button', 'lp-rd-b lp-rd-sw lp-rd-sw-' + k);
      b.type = 'button';
      lab(b, 'aria-label', 'rd.' + k);
      lab(b, 'title', 'rd.' + k);
      b.setAttribute('aria-pressed', k === th ? 'true' : 'false');
      b.addEventListener('click', function () {
        th = k;
        setPref('th', k);
        page.className = 'lp-rd-page lp-rd-th-' + k;
        thb.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
      seg.appendChild(b);
      return b;
    });
    function size(n) {
      var frac = progress();
      fs = Math.max(0, Math.min(SIZES.length - 1, n));
      setPref('fs', fs);
      doc.style.setProperty('--lp-rd-fs', SIZES[fs] + 'px');
      smaller.disabled = fs === 0;
      larger.disabled = fs === SIZES.length - 1;
      restore(frac);
    }
    smaller.addEventListener('click', function () { size(fs - 1); });
    larger.addEventListener('click', function () { size(fs + 1); });
    smaller.disabled = fs === 0;
    larger.disabled = fs === SIZES.length - 1;
    [pct, smaller, larger, seg, dlButton(id)].forEach(function (x) { S.tools.appendChild(x); });
    page.appendChild(doc);
    S.body.appendChild(prog);
    S.body.appendChild(page);
    var w = wait(S);
    var body = S.body;
    function progress() {
      var max = body.scrollHeight - body.clientHeight;
      return max > 0 ? Math.min(1, Math.max(0, body.scrollTop / max)) : 0;
    }
    function show() {
      bar.style.width = Math.round(progress() * 100) + '%';
      relabelPct();
    }
    var relabelPct = function () { pct.textContent = R.t('rd.progress', { p: Math.round(progress() * 100) }); };
    labels.push([pct, '', 'rd.progress', function () { return { p: Math.round(progress() * 100) }; }]);
    function restore(f) {
      var max = body.scrollHeight - body.clientHeight;
      if (max > 0) body.scrollTop = f * max;
      show();
    }
    // Position stored as a fraction of the scroll range (not pixels): it survives font-size changes and viewport
    // resizes. Writes throttled to one per 600 ms; closing the reader writes the final value.
    var t0 = 0;
    body.addEventListener('scroll', function () {
      show();
      var now = Date.now();
      if (now - t0 > 600) { t0 = now; setPos(key, { s: Math.round(progress() * 10000) / 10000 }); }
    }, { passive: true });
    S.onClose = function () { setPos(key, { s: Math.round(progress() * 10000) / 10000 }); };
    var b0 = R.blob(id);
    b0.then(function (b) {
      return b.text ? b.text() : new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result || '')); }; fr.onerror = rej; fr.readAsText(b); });
    }).then(function (text) {
      if (w.parentNode) w.parentNode.removeChild(w);
      // Strip a UTF-8 BOM and normalize CRLF / CR so line-based Markdown parsing sees one line ending.
      text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      var md = /markdown/.test(base(id)) || /\.(md|markdown)$/i.test(R.meta(id).name);
      if (md) blocks(text.replace(/\t/g, '    ').split('\n'), doc, 0); else plain(text, doc);
      var saved = getPos(key);
      var at = saved && saved.s > 0 ? Math.min(1, Number(saved.s) || 0) : 0;
      // Reading scrollHeight lays the text out now; once more after the next frame (late font swaps).
      restore(at);
      if (at && window.requestAnimationFrame) requestAnimationFrame(function () { if (Math.abs(progress() - at) > 0.01) restore(at); });
    }).catch(function () {
      // No bytes in the page (archive export: the file sits next to it) → the browser's own text view of that file.
      R.url(id).then(function (u) {
        S.body.textContent = '';
        var o = d.createElement('object');
        o.className = 'lp-rd-obj';
        o.setAttribute('type', 'text/plain');
        o.setAttribute('data', u);
        S.body.appendChild(o);
      }).catch(function () { failed(S, id); });
    });
  }

  /* pdf, video, image */
  function openPdf(item, id, opener) {
    var S = shell('pdf', item, id, opener);
    fileLabel(item, id, S.sub);
    var op = button('lp-rd-b', 'open', 'open');
    op.setAttribute('data-att-op', '');
    op.setAttribute('data-att', id);
    lab(op, 'title', 'open');
    S.tools.appendChild(op);
    S.tools.appendChild(dlButton(id));
    var w = wait(S);
    R.url(id).then(function (u) {
      if (w.parentNode) w.parentNode.removeChild(w);
      var o = d.createElement('object');
      o.className = 'lp-rd-obj';
      o.setAttribute('type', 'application/pdf');
      o.setAttribute('data', u + '#view=FitH');
      lab(o, 'aria-label', 'open');
      var fb = el('div', 'lp-rd-fb');
      fb.appendChild(lab(el('p'), '', 'rd.failed'));
      var b = R.el('button', 'lp-btn lp-btn-primary');
      b.type = 'button';
      b.setAttribute('data-att-op', '');
      b.setAttribute('data-att', id);
      b.appendChild(svg('open'));
      b.appendChild(lab(el('span'), '', 'open'));
      fb.appendChild(b);
      o.appendChild(fb);
      S.body.appendChild(o);
    }).catch(function () { failed(S, id); });
  }
  function openVideo(item, id, opener) {
    var S = shell('video', item, id, opener);
    fileLabel(item, id, S.sub);
    var key = keyOf(item, id) + '/' + id;
    var v = d.createElement('video');
    v.className = 'lp-rd-vid';
    v.controls = true;
    v.setAttribute('playsinline', '');
    v.preload = 'metadata';
    var saved = getPos(key);
    S.tools.appendChild(speedSelect(function () { return v; }));
    S.tools.appendChild(dlButton(id));
    S.body.appendChild(v);
    var t0 = 0;
    v.addEventListener('loadedmetadata', function () {
      if (saved && saved.t > 3) { try { v.currentTime = Math.min(saved.t - 2, (v.duration || saved.t) - 1); } catch (e) { /* ignore */ } }
    });
    v.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - t0 > 5000) { t0 = now; setPos(key, { t: Math.round(v.currentTime || 0) }); }
    });
    v.addEventListener('ended', function () { setPos(key, null); });
    v.addEventListener('error', function () { failed(S, id); });
    S.onClose = function () {
      try { v.pause(); } catch (e) { /* ignore */ }
      if (!v.ended && v.currentTime > 3) setPos(key, { t: Math.round(v.currentTime) });
    };
    R.url(id).then(function (u) {
      v.src = u;
      v.defaultPlaybackRate = rate();
      v.playbackRate = rate();
      try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { /* needs a click */ }); } catch (e) { /* ignore */ }
    }).catch(function () { failed(S, id); });
  }
  function openImage(item, id, opener) {
    var S = shell('image', item, id, opener);
    fileLabel(item, id, S.sub);
    S.tools.appendChild(dlButton(id));
    var box = el('div', 'lp-rd-img');
    S.body.appendChild(box);
    R.url(id).then(function (u) {
      var im = el('img');
      im.alt = (S.sub.textContent || '').trim();
      im.src = u;
      box.appendChild(im);
    }).catch(function () { failed(S, id); });
  }

  d.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-lp-read]') : null;
    if (!b || !R.url) return;
    e.preventDefault();
    if (M) M.close();
    var id = b.getAttribute('data-lp-read');
    var k = b.getAttribute('data-lp-rk');
    var item = itemOf(b);
    if (k === 'audio') openAudio(item, id, b);
    else if (k === 'video') openVideo(item, id, b);
    else if (k === 'text') openText(item, id, b);
    else if (k === 'pdf') openPdf(item, id, b);
    else if (k === 'image') openImage(item, id, b);
  });
  // One sound at a time: another player that starts pauses the reader's audio (and the reader pauses the others).
  d.addEventListener('play', function (e) {
    var t = e.target;
    if (!t || t.muted) return;
    if (A && t !== A && !A.paused) A.pause();
    if (t === A) R.$$('audio,video').forEach(function (m) { if (m !== A && !m.muted && !m.paused) { try { m.pause(); } catch (x) { /* ignore */ } } });
  }, true);
  window.addEventListener('pagehide', save);
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') save(); });
}

/* ---------- CSS (overlays live outside .lp-root: every token has a fallback) ---------- */

const CL_FONT = 'var(--lp-font,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",Sylfaen,sans-serif)';
const CL_READ_FONT = 'Charter,"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,"Noto Serif","Noto Serif Georgian","BPG Nino Medium",Sylfaen,serif';

const CSS_FEAT_COL = {
  collection: `
.lp-cdm{position:fixed;inset:0;z-index:1550;display:flex;align-items:center;justify-content:center;padding:max(12px,3vmin);background:rgba(8,10,14,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);font-family:${CL_FONT};font-size:var(--lp-fs,16px);line-height:var(--lp-lh,1.55);color:var(--lp-text,#16191e);box-sizing:border-box;animation:lp-cl-fade .2s ease-out}
.lp-cdm *,.lp-cdm *::before,.lp-cdm *::after{box-sizing:border-box}
.lp-cdm-panel{position:relative;display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);width:min(980px,100%);max-height:100%;overflow:auto;border-radius:var(--lp-radius,12px);background:var(--lp-bg,#fff);box-shadow:var(--lp-shadow-lg,0 24px 70px rgba(0,0,0,.35));overscroll-behavior:contain;animation:lp-cl-pop .24s var(--lp-ease,ease-out)}
.lp-cdm-panel.lp-cdm-nocv{grid-template-columns:minmax(0,1fr);width:min(760px,100%)}
.lp-cdm-cv{position:relative;align-self:start;min-width:0}
.lp-cdm-cv>img{position:sticky;top:0;display:block;width:100%;height:auto;max-height:min(86vh,760px);object-fit:cover}
.lp-cdm-cv>.lp-cl-nocv{height:100%;min-height:22em}
.lp-cdm-main{display:flex;flex-direction:column;align-items:flex-start;gap:12px;min-width:0;padding:clamp(22px,3vw,38px)}
.lp-cdm-main>*{max-width:100%}
.lp-cdm-t{margin:0;padding-inline-end:40px;font-family:var(--lp-font-h,inherit);font-size:clamp(1.35em,1.1em + 1vw,1.85em);font-weight:700;line-height:1.18;letter-spacing:-.01em;overflow-wrap:anywhere}
.lp-cdm-main>.lp-cl-badge{position:static;box-shadow:none}
.lp-cdm-main>.lp-cl-foot,.lp-cdm-main>.lp-cdm-body,.lp-cdm-main>.lp-cl-acts{align-self:stretch}
.lp-cdm-body{display:flex;flex-direction:column;gap:16px;margin-top:4px;padding:16px 0 0;border-top:1px solid var(--lp-border,#e3e6ea)}
.lp-cdm-body .lp-kv{width:100%}
.lp-cdm-x{position:absolute;top:10px;inset-inline-end:10px;z-index:3;display:grid;place-items:center;width:40px;height:40px;margin:0;padding:0;border:0;border-radius:50%;background:var(--lp-bg,#fff);color:var(--lp-text,#16191e);font:400 26px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.2)}
.lp-cdm-x:hover{background:var(--lp-hover,#eef0f3)}
.lp-cdm-x:focus-visible{outline:2px solid var(--lp-link,#2453d8);outline-offset:2px}
@media (max-width:720px){.lp-cdm{padding:0;align-items:stretch}.lp-cdm-panel{grid-template-columns:minmax(0,1fr);width:100%;max-height:none;height:100%;border-radius:0}.lp-cdm-cv{min-height:0}.lp-cdm-cv>img{position:static;max-height:44vh}.lp-cdm-cv>.lp-cl-nocv{min-height:0;max-height:44vh}}
@keyframes lp-cl-fade{from{opacity:0}}
@keyframes lp-cl-pop{from{opacity:0;transform:translateY(10px) scale(.985)}}
@media (prefers-reduced-motion:reduce){.lp-cdm,.lp-cdm-panel{animation:none}}
@media print{.lp-cdm{display:none!important}}
`,
  reader: `
.lp-rd,.lp-dock{font-family:${CL_FONT};font-size:var(--lp-fs,16px);line-height:var(--lp-lh,1.55);color:var(--lp-text,#16191e);box-sizing:border-box}
.lp-rd *,.lp-rd *::before,.lp-rd *::after,.lp-dock *{box-sizing:border-box}
.lp-rd[hidden],.lp-dock[hidden],.lp-rd [hidden]{display:none!important}
.lp-rd .lp-ic,.lp-dock .lp-ic{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.lp-rd{position:fixed;inset:0;z-index:1600;display:flex;align-items:center;justify-content:center;padding:max(12px,3vmin);background:rgba(8,10,14,.72);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:lp-rd-fade .2s ease-out}
.lp-rd-panel{display:flex;flex-direction:column;width:min(760px,100%);max-height:100%;overflow:hidden;border-radius:var(--lp-radius,12px);background:var(--lp-bg,#fff);box-shadow:var(--lp-shadow-lg,0 24px 70px rgba(0,0,0,.4));animation:lp-rd-pop .24s var(--lp-ease,ease-out)}
.lp-rd-text .lp-rd-panel,.lp-rd-pdf .lp-rd-panel{width:min(1040px,100%);height:100%}
.lp-rd-video .lp-rd-panel{width:min(1120px,100%)}
.lp-rd-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:14px 12px 12px 22px;border-bottom:1px solid var(--lp-border,#e3e6ea)}
.lp-rd-tt{flex:1 1 14em;min-width:0}
.lp-rd-t{margin:0;font-family:var(--lp-font-h,inherit);font-size:1.14em;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
.lp-rd-sub{margin:3px 0 0;color:var(--lp-muted,#5b6472);font-size:.88em;line-height:1.35;overflow-wrap:anywhere}
.lp-rd-sub:empty{display:none}
.lp-rd-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.lp-rd-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:40px;height:40px;margin:0;padding:0 11px;border:1px solid var(--lp-border-s,#cfd5dd);border-radius:999px;background:var(--lp-bg,#fff);color:var(--lp-text,#16191e);font:inherit;font-size:.9em;font-weight:650;line-height:1;cursor:pointer;transition:background-color .15s,border-color .15s}
.lp-rd-b .lp-ic{width:18px;height:18px}
.lp-rd-b:hover{background:var(--lp-hover,#f1f3f6)}
.lp-rd-b:disabled{opacity:.4;cursor:default}
.lp-rd-b[aria-pressed="true"]{border-color:var(--lp-accent,#2453d8);box-shadow:0 0 0 2px var(--lp-accent,#2453d8)}
.lp-rd-big{font-size:1.08em}
.lp-rd-seg{display:inline-flex;gap:6px}
.lp-rd-sw{width:40px;padding:0}
.lp-rd-sw::before{content:"";width:18px;height:18px;border-radius:50%;border:1px solid rgba(0,0,0,.25)}
.lp-rd-sw-light::before{background:#fff}
.lp-rd-sw-sepia::before{background:#f4ecd8}
.lp-rd-sw-dark::before{background:#15171b;border-color:rgba(255,255,255,.35)}
.lp-rd-x{display:grid;place-items:center;width:42px;height:42px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;font:400 28px/1 system-ui,sans-serif;cursor:pointer}
.lp-rd-x:hover{background:var(--lp-hover,#f1f3f6)}
.lp-rd :focus-visible,.lp-dock :focus-visible{outline:2px solid var(--lp-link,#2453d8);outline-offset:2px}
.lp-rd-body{position:relative;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.lp-rd-wait{margin:0;padding:48px 20px;color:var(--lp-muted,#5b6472);text-align:center}
.lp-rd-fb{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-height:36vh;padding:32px 22px;color:var(--lp-muted,#5b6472);text-align:center}
.lp-rd-fb p{margin:0;max-width:30em}
.lp-rd-note{margin:0;color:var(--lp-danger,#b91c1c);font-size:.88em}
.lp-rd-player{display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr);align-items:center;gap:24px;padding:24px}
.lp-rd-art{display:grid;place-items:center;aspect-ratio:1/1;overflow:hidden;border-radius:calc(var(--lp-radius,12px) * .8);background:linear-gradient(150deg,var(--lp-accent,#2453d8),color-mix(in srgb,var(--lp-accent,#2453d8) 55%,#000));color:var(--lp-on-accent,#fff);box-shadow:0 14px 30px -14px rgba(0,0,0,.5)}
.lp-rd-art img{display:block;width:100%;height:100%;object-fit:cover}
.lp-rd-art .lp-ic{width:56px;height:56px;stroke-width:1.5}
.lp-rd-main{display:flex;flex-direction:column;gap:16px;min-width:0}
.lp-rd-seekrow{display:grid;grid-template-columns:3.4em minmax(0,1fr) 3.4em;align-items:center;gap:10px;color:var(--lp-muted,#5b6472);font-size:.84em;font-variant-numeric:tabular-nums}
.lp-rd-dur{text-align:end}
.lp-rd-seek{width:100%;margin:0;accent-color:var(--lp-accent,#2453d8);cursor:pointer}
.lp-rd-ctrls{display:flex;align-items:center;justify-content:center;gap:8px}
.lp-rd-c{display:inline-grid;place-items:center;width:46px;height:46px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;transition:background-color .15s,transform .15s}
.lp-rd-c:hover{background:var(--lp-hover,#f1f3f6)}
.lp-rd-c:disabled{opacity:.32;cursor:default;background:transparent}
.lp-rd-pp{width:66px;height:66px;background:var(--lp-accent,#2453d8);color:var(--lp-on-accent,#fff);box-shadow:0 10px 24px -10px var(--lp-accent,#2453d8)}
.lp-rd-pp:hover{background:var(--lp-accent-h,var(--lp-accent,#2453d8));transform:scale(1.04)}
.lp-rd .lp-rd-pp .lp-ic,.lp-dock .lp-dock-pp .lp-ic{width:26px;height:26px;fill:currentColor;stroke:none}
.lp-rd-opts{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.lp-rd-speed{display:inline-flex;align-items:center;gap:8px;color:var(--lp-muted,#5b6472);font-size:.88em}
.lp-rd-speed select,.lp-rd-tools select{min-height:38px;margin:0;padding:4px 12px;border:1px solid var(--lp-border-s,#cfd5dd);border-radius:999px;background:var(--lp-bg,#fff);color:var(--lp-text,#16191e);font:inherit;font-variant-numeric:tabular-nums;cursor:pointer}
.lp-rd-chap{padding:0 24px 24px}
.lp-rd-chap h3{margin:0 0 10px;color:var(--lp-muted,#5b6472);font-size:.78em;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.lp-rd-chap h3:lang(ka){text-transform:none;letter-spacing:.02em}
.lp-rd-list{margin:0;padding:0;list-style:none;border:1px solid var(--lp-border,#e3e6ea);border-radius:calc(var(--lp-radius,12px) * .7);overflow:hidden}
.lp-rd-list li+li{border-top:1px solid var(--lp-border,#e3e6ea)}
.lp-rd-ch{display:flex;align-items:baseline;gap:12px;width:100%;margin:0;padding:11px 16px;border:0;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.lp-rd-ch:hover{background:var(--lp-hover,#f1f3f6)}
.lp-rd-ch[aria-current="true"]{background:var(--lp-tint,rgba(36,83,216,.1));color:var(--lp-link,#2453d8);font-weight:650}
.lp-rd-n{min-width:1.6em;color:var(--lp-muted,#5b6472);font-variant-numeric:tabular-nums}
.lp-rd-cl{min-width:0;overflow-wrap:anywhere}
.lp-rd-prog{position:sticky;top:0;z-index:2;height:3px;background:color-mix(in srgb,var(--lp-accent,#2453d8) 16%,transparent)}
.lp-rd-prog>span{display:block;width:0;height:100%;background:var(--lp-accent,#2453d8)}
.lp-rd-pct{min-width:4.6em;color:var(--lp-muted,#5b6472);font-size:.84em;font-variant-numeric:tabular-nums;text-align:end}
.lp-rd-page{min-height:100%;padding:clamp(22px,5vw,60px) clamp(18px,6vw,72px);background:#fff;color:#1f2328;transition:background-color .2s,color .2s}
.lp-rd-th-sepia{background:#f4ecd8;color:#3f3324}
.lp-rd-th-dark{background:#15171b;color:#d9dce1}
.lp-rd-doc{max-width:36em;margin:0 auto;font-family:${CL_READ_FONT};font-size:var(--lp-rd-fs,19.5px);line-height:1.72;overflow-wrap:break-word;hyphens:auto;text-wrap:pretty}
.lp-rd-doc>:first-child{margin-top:0}
.lp-rd-doc p{margin:0 0 1em}
.lp-rd-doc .lp-rd-lines{white-space:pre-line}
.lp-rd-doc :is(h1,h2,h3,h4,h5,h6){margin:1.6em 0 .6em;font-family:inherit;font-weight:700;line-height:1.25;color:inherit}
.lp-rd-doc h1{font-size:1.7em}
.lp-rd-doc h2{font-size:1.4em}
.lp-rd-doc h3{font-size:1.18em}
.lp-rd-doc :is(h4,h5,h6){font-size:1em}
.lp-rd-doc :is(ul,ol){margin:0 0 1em;padding-inline-start:1.5em}
.lp-rd-doc li{margin:.25em 0}
.lp-rd-doc blockquote{margin:1.2em 0;padding:.1em 0;padding-inline-start:1em;border-inline-start:3px solid currentColor;opacity:.85;font-style:italic}
.lp-rd-doc pre{margin:1.2em 0;padding:.9em 1.1em;overflow:auto;border-radius:6px;background:rgba(127,127,127,.12);font:.82em/1.5 ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;white-space:pre}
.lp-rd-doc code{padding:.08em .3em;border-radius:4px;background:rgba(127,127,127,.14);font:.86em ui-monospace,"Cascadia Code",Menlo,Consolas,monospace}
.lp-rd-doc pre code{padding:0;background:none;font:inherit}
.lp-rd-doc hr{margin:2em auto;width:30%;border:0;border-top:1px solid currentColor;opacity:.35}
.lp-rd-doc a{color:inherit;text-decoration:underline;text-underline-offset:.18em}
.lp-rd-tbl{margin:1.2em 0;overflow-x:auto}
.lp-rd-doc table{border-collapse:collapse;font-size:.88em}
.lp-rd-doc :is(th,td){padding:.4em .8em;border:1px solid rgba(127,127,127,.35);text-align:start}
.lp-rd-obj{display:block;width:100%;height:100%;min-height:62vh;border:0;background:var(--lp-hover,#f1f3f6)}
.lp-rd-vid{display:block;width:100%;max-height:calc(100vh - 160px);background:#000}
.lp-rd-img{display:grid;place-items:center;min-height:50vh;padding:14px;background:#111}
.lp-rd-img img{display:block;max-width:100%;max-height:calc(100vh - 170px);object-fit:contain}
.lp-dock{position:fixed;z-index:1150;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:8px;width:min(540px,calc(100vw - 24px));padding:7px;transform:translateX(-50%);overflow:hidden;border:1px solid var(--lp-border,#e3e6ea);border-radius:999px;background:var(--lp-bg,#fff);background:color-mix(in srgb,var(--lp-bg,#fff) 90%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);box-shadow:var(--lp-shadow-lg,0 14px 40px rgba(15,23,42,.25));animation:lp-rd-up .25s var(--lp-ease,ease-out)}
.lp-dock-pp{display:inline-grid;place-items:center;flex:none;width:46px;height:46px;margin:0;padding:0;border:0;border-radius:50%;background:var(--lp-accent,#2453d8);color:var(--lp-on-accent,#fff);cursor:pointer}
.lp-dock-t{display:flex;flex:1;flex-direction:column;align-items:flex-start;min-width:0;margin:0;padding:2px 6px;border:0;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.lp-dock-a,.lp-dock-b{max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lp-dock-a{font-size:.92em;font-weight:650;line-height:1.3}
.lp-dock-b{color:var(--lp-muted,#5b6472);font-size:.8em;line-height:1.3}
.lp-dock-x{display:grid;place-items:center;flex:none;width:40px;height:40px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:var(--lp-muted,#5b6472);font:400 24px/1 system-ui,sans-serif;cursor:pointer}
.lp-dock-x:hover{background:var(--lp-hover,#f1f3f6);color:var(--lp-text,#16191e)}
.lp-dock-bar{position:absolute;left:28px;right:28px;bottom:2px;height:2px;overflow:hidden;border-radius:2px;background:var(--lp-border,#e3e6ea)}
.lp-dock-bar>span{display:block;width:0;height:100%;background:var(--lp-accent,#2453d8)}
@media (max-width:640px){.lp-rd{padding:0;align-items:stretch}.lp-rd-panel,.lp-rd-text .lp-rd-panel,.lp-rd-pdf .lp-rd-panel,.lp-rd-video .lp-rd-panel{width:100%;height:100%;max-height:none;border-radius:0}.lp-rd-head{padding:10px 8px 10px 16px}.lp-rd-tools{order:3;flex-basis:100%}.lp-rd-player{grid-template-columns:minmax(0,1fr);justify-items:center;padding:20px 18px}.lp-rd-art{width:min(62vw,250px)}.lp-rd-main{width:100%}.lp-rd-chap{padding:0 18px 20px}.lp-dock.lp-dock-fab{left:12px;width:calc(100vw - 98px);transform:none}}
@keyframes lp-rd-fade{from{opacity:0}}
@keyframes lp-rd-pop{from{opacity:0;transform:translateY(10px) scale(.985)}}
@keyframes lp-rd-up{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.lp-rd,.lp-rd-panel,.lp-dock{animation:none}}
@media print{.lp-rd,.lp-dock{display:none!important}}
`,
};

export {
  CSS_FEAT_COL,
  rtCollection,
  rtReader
};
