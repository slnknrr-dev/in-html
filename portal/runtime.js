// portal/runtime.js - runtime features of the portal blocks, one implementation for both applications. Each feature is
// `function ptX(R)` that references only R, its own locals and browser globals: landing serializes them with
// Function.prototype.toString into exported pages (doc/runtime.js), the knowledge reader calls them directly. They use
// prefix-free data attributes only (markup.js lists the contract), never class names. ES5-ish, strict-mode safe, no UI
// text (R.t), and none of the minifier traps (no division right after '}', no HTML comment tokens).
//
// R contract: R.t(key, vars) (plurals), R.lang(), R.store { get(k) -> string | null, set(k, string) } (optional),
// R.sid or R.cfg.id (storage namespace, optional), R.live(text) (optional). ptbase creates R.pt:
//   R.pt.add(fn(root))   register a scanner; it runs on the document at once and on every R.pt.scan(root)
//   R.pt.scan(root)      after new markup was inserted (knowledge renders pages on navigation)
//   R.pt.fold(s)         the folding of text.js (search text in data-pt-s is folded the same way)
//   R.pt.lv(v)           per-language value { lang: text } in the current language
//   R.pt.get(k) / R.pt.set(k, v)   JSON storage under 'pt-<k>:<site>'
//
//   PT_FEATURES { ptbase, pttoc, pttips, ptlist, ptfind, ptcheck }, PT_FEATURE_ORDER, PT_FEATURE_DEPS

/* ---------- base: scanning, folding, storage, copy link, print, reveal, relative dates, language switch ---------- */

// Base feature. Comments must stay outside the feature functions where possible: the bodies are shipped verbatim
// via toString. Storage keys are namespaced per site (R.sid / cfg.id / path) so two exported sites on one origin
// do not share checklist ticks. say() clears the live region and sets the text after a tick, which makes screen
// readers re-announce identical messages. A MutationObserver on html[lang] reruns labels / dates on a language switch
// without the language switcher having to know about portal blocks.
function ptBase(R) {
  var d = document;
  var hop = Object.prototype.hasOwnProperty;
  var MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
  var scanners = [];
  var langHooks = [];
  function fold(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKD'); } catch (e) { /* old engine */ }
    return s.replace(MARKS, '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
  }
  function lang() { return R.lang ? R.lang() : (d.documentElement.lang || 'en'); }
  function t(k, v) { var s = R.t ? R.t(k, v) : ''; return s || ''; }
  function lv(v) {
    if (!v || typeof v !== 'object') return v;
    var l = lang();
    if (hop.call(v, l)) return v[l];
    for (var k in v) if (hop.call(v, k)) return v[k];
    return '';
  }
  function skey(k) { return 'pt-' + k + ':' + (R.sid || (R.cfg && R.cfg.id) || location.pathname); }
  function get(k) {
    try {
      var s = R.store ? R.store.get(skey(k)) : window.localStorage.getItem(skey(k));
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function set(k, v) {
    try {
      var s = JSON.stringify(v);
      if (R.store) R.store.set(skey(k), s); else window.localStorage.setItem(skey(k), s);
    } catch (e) { /* storage blocked */ }
  }
  var liveEl = null;
  function say(text) {
    if (!text) return;
    if (R.live) { R.live(text); return; }
    if (!liveEl) {
      liveEl = d.createElement('div');
      liveEl.setAttribute('data-pt-live', '');
      liveEl.setAttribute('role', 'status');
      liveEl.setAttribute('aria-live', 'polite');
      liveEl.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
      d.body.appendChild(liveEl);
    }
    liveEl.textContent = '';
    setTimeout(function () { liveEl.textContent = text; }, 40);
  }
  function dayNum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
  }
  function today() { var x = new Date(); return Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5); }
  // <time data-pt-rel="ago|until" datetime> texts follow the visitor's today, not the export day.
  function relTimes(root) {
    var list = (root || d).querySelectorAll('time[data-pt-rel]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var n = dayNum(el.getAttribute('datetime'));
      if (n == null) continue;
      var dd = today() - n;
      var s = '';
      if (el.getAttribute('data-pt-rel') === 'ago') s = dd <= 0 ? t('pt.rq.today') : t('pt.rq.posted', { n: dd });
      else s = -dd < 0 ? t('pt.rq.ended') : -dd === 0 ? t('pt.rq.closesToday') : t('pt.rq.closesIn', { n: -dd });
      if (s) el.textContent = s;
      if (el.getAttribute('data-pt-rel') === 'until') el.setAttribute('data-pt-soon', -dd <= 3 ? '1' : '0');
    }
  }
  function relabel(root) {
    var list = (root || d).querySelectorAll('[data-pt-l]');
    for (var i = 0; i < list.length; i++) {
      var m = null;
      try { m = JSON.parse(list[i].getAttribute('data-pt-l')); } catch (e) { m = null; }
      var x = m ? lv(m) : '';
      var n = list[i].getAttribute('data-pt-n');
      if (x) list[i].textContent = x + (n ? ' (' + n + ')' : '');
    }
  }
  function scan(root) {
    root = root || d;
    var roots = root.querySelectorAll ? root.querySelectorAll('[data-pt]') : [];
    for (var i = 0; i < roots.length; i++) roots[i].setAttribute('data-pt-js', '');
    if (root.getAttribute && root.hasAttribute('data-pt')) root.setAttribute('data-pt-js', '');
    relTimes(root);
    relabel(root);
    for (var k = 0; k < scanners.length; k++) { try { scanners[k](root); } catch (e) { /* one broken block */ } }
  }
  R.pt = {
    fold: fold, lv: lv, t: t, lang: lang, get: get, set: set, say: say,
    add: function (fn) { scanners.push(fn); try { fn(d); } catch (e) { /* ignore */ } },
    onLang: function (fn) { langHooks.push(fn); },
    scan: scan,
  };

  function copyText(text, done) {
    function fallback() {
      var ta = d.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      d.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = d.execCommand('copy'); } catch (e) { ok = false; }
      d.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  d.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-pt-copy],[data-pt-print],[data-pt-reveal]') : null;
    if (!el) return;
    if (el.hasAttribute('data-pt-copy')) {
      var href = el.getAttribute('data-pt-copy');
      var url = href;
      try { url = new URL(href, location.href).href; } catch (x) { url = href; }
      copyText(url, function (ok) {
        if (!ok) return;
        el.setAttribute('data-pt-copied', '');
        say(t('pt.copied'));
        setTimeout(function () { el.removeAttribute('data-pt-copied'); }, 1600);
      });
    } else if (el.hasAttribute('data-pt-print')) {
      var root = el.closest('[data-pt]');
      var h = d.documentElement;
      if (root) root.setAttribute('data-pt-printing', '');
      h.setAttribute('data-pt-print', '');
      var end = function () {
        h.removeAttribute('data-pt-print');
        if (root) root.removeAttribute('data-pt-printing');
        window.removeEventListener('afterprint', end);
      };
      window.addEventListener('afterprint', end);
      try { window.print(); } catch (x) { /* blocked */ }
      setTimeout(end, 1000);
    } else {
      var m = el.closest('[data-pt-mask]');
      if (m) {
        m.setAttribute('data-pt-shown', '');
        var a = m.querySelector('a');
        if (a) a.focus();
      }
    }
  });
  // Language switches (html[lang] changes): per-language labels and relative dates.
  if (window.MutationObserver) {
    new MutationObserver(function () {
      relabel(d);
      relTimes(d);
      for (var i = 0; i < langHooks.length; i++) { try { langHooks[i](); } catch (e) { /* ignore */ } }
    }).observe(d.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  scan(d);
}

/* ---------- scroll-spy of tables of contents and alphabet bars ---------- */

// Scroll spy: IntersectionObserver tracks which targets are near the view (cheap), and pick() measures only those on
// scroll (rAF-throttled, passive listener). The active entry is the last target whose top passed a reading line;
// aria-current marks it for AT. The contents list scrolls itself, never the page.
function ptToc(R) {
  var d = document;
  function setup(nav) {
    if (nav.ptOn) return;
    nav.ptOn = 1;
    var links = nav.querySelectorAll('a[href]');
    var map = [];
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var id = href.slice(href.lastIndexOf('#') + 1);
      try { id = decodeURIComponent(id); } catch (e) { /* keep */ }
      var el = id ? d.getElementById(id) : null;
      if (el) map.push({ a: links[i], el: el });
    }
    if (!map.length) return;
    // A table of contents beside a narrow column starts folded.
    var root = nav.closest('[data-pt]');
    var det = nav.querySelector('details');
    // Decided once the block has a width (a hidden page has none until it is shown).
    var folded = false;
    function fold() {
      if (folded || !det || !root || !root.clientWidth) return;
      folded = true;
      if (root.clientWidth < 720) det.open = false;
    }
    fold();
    if (!window.IntersectionObserver) return;
    var vis = [];
    var cur = null;
    // The entry being read: the last one (document order) whose start passed the reading line (a third down the
    // window), among the targets near the view; nested sections lose to the article inside them.
    function pick() {
      fold();
      if (!vis.length) return;
      var line = Math.min(window.innerHeight * 0.3, 160);
      var best = null;
      var first = null;
      for (var k = 0; k < map.length; k++) {
        var r = map[k].el.getBoundingClientRect();
        if (!r.height && !r.width) continue;
        if (r.bottom > 0 && !first) first = map[k];
        if (r.top <= line && r.bottom > 0) best = map[k];
      }
      best = best || first;
      if (!best || best === cur) return;
      if (cur) cur.a.removeAttribute('aria-current');
      cur = best;
      cur.a.setAttribute('aria-current', 'true');
      // Keep the active entry in view inside a scrolling list (never scrolls the page).
      var box = nav.querySelector('ol') || nav;
      var sc = box.scrollHeight > box.clientHeight + 4 ? box : nav.scrollHeight > nav.clientHeight + 4 ? nav : null;
      if (sc) {
        var r = cur.a.getBoundingClientRect();
        var b = sc.getBoundingClientRect();
        if (r.top < b.top || r.bottom > b.bottom) sc.scrollTop += r.top - b.top - b.height * 0.4;
      }
      if (nav.scrollWidth > nav.clientWidth + 4) {
        var rr = cur.a.getBoundingClientRect();
        var nb = nav.getBoundingClientRect();
        if (rr.left < nb.left || rr.right > nb.right) nav.scrollLeft += rr.left - nb.left - nb.width * 0.4;
      }
    }
    var io = new IntersectionObserver(function (es) {
      for (var k = 0; k < es.length; k++) {
        var j = vis.indexOf(es[k].target);
        if (es[k].isIntersecting) { if (j < 0) vis.push(es[k].target); } else if (j >= 0) vis.splice(j, 1);
      }
      pick();
    });
    for (var n = 0; n < map.length; n++) io.observe(map[n].el);
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued || !vis.length) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () { queued = false; pick(); });
    }, { passive: true });
  }
  R.pt.add(function (root) {
    var navs = root.querySelectorAll('[data-pt-spy]');
    for (var i = 0; i < navs.length; i++) setup(navs[i]);
  });
}

/* ---------- definitions of linked terms in a popover ---------- */

// Term popover: one shared element per block (role="tooltip", aria-describedby on the focused link), shown on hover
// after a delay (no flicker when the mouse passes over) and immediately on focus (keyboard users), hidden on Escape.
// Content is copied from the pre-rendered, escaped definitions (tipsHTML).
function ptTips(R) {
  var d = document;
  var pop = null;
  var on = null;
  var timer = 0;
  function defOf(id) {
    var l = R.pt.lang();
    var list = d.querySelectorAll('[data-pt-tipd]');
    var any = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-pt-tipd') !== id) continue;
      if (list[i].getAttribute('data-pt-lang') === l) return list[i];
      if (!any) any = list[i];
    }
    return any;
  }
  function hide() {
    clearTimeout(timer);
    if (pop) pop.hidden = true;
    if (on) on.removeAttribute('aria-describedby');
    on = null;
  }
  function show(a) {
    var def = defOf(a.getAttribute('data-pt-tip'));
    if (!def) return;
    var host = a.closest('[data-pt]') || d.body;
    if (!pop || pop.parentNode !== host) {
      if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
      pop = d.createElement('div');
      pop.setAttribute('data-pt-pop', '');
      pop.setAttribute('role', 'tooltip');
      pop.id = 'pt-pop';
      host.appendChild(pop);
    }
    pop.innerHTML = def.innerHTML;
    pop.hidden = false;
    var r = a.getBoundingClientRect();
    var h = host.getBoundingClientRect();
    var w = pop.offsetWidth;
    var x = r.left - h.left;
    var maxX = Math.max(8, host.clientWidth - w - 8);
    if (x > maxX) x = maxX;
    if (x < 8) x = 8;
    var y = r.bottom - h.top + 6;
    if (r.bottom + pop.offsetHeight + 12 > window.innerHeight && r.top - pop.offsetHeight - 8 > 0) y = r.top - h.top - pop.offsetHeight - 6;
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    a.setAttribute('aria-describedby', 'pt-pop');
    on = a;
  }
  function target(e) { return e.target && e.target.closest ? e.target.closest('a[data-pt-tip]') : null; }
  d.addEventListener('mouseover', function (e) {
    var a = target(e);
    if (!a || a === on) return;
    clearTimeout(timer);
    timer = setTimeout(function () { show(a); }, 260);
  });
  d.addEventListener('mouseout', function (e) {
    var a = target(e);
    if (!a) return;
    var to = e.relatedTarget;
    if (to && (a.contains(to) || (pop && pop.contains(to)))) return;
    clearTimeout(timer);
    timer = setTimeout(hide, 160);
  });
  d.addEventListener('focusin', function (e) { var a = target(e); if (a) show(a); });
  d.addEventListener('focusout', function (e) { if (target(e)) hide(); });
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', function () { if (on && pop && !pop.hidden) show(on); }, { passive: true });
  R.pt.add(function () { /* delegated: nothing per block */ });
}

/* ---------- lists: search, tabs, facets, sorting, paging, alphabet groups ---------- */

// List tools: items are filtered by folded substring (data-pt-s) and padded facet tokens (data-pt-f); sorting moves
// DOM nodes only when the sort key changed (re-appending on every keystroke would thrash layout). Groups with no
// visible item and contents entries of hidden items are hidden too. Paging shows the first N hits.
function ptList(R) {
  var d = document;
  var pt = R.pt;
  var collCache = null;
  var collLang = '';
  function cmp(a, b) {
    var l = pt.lang();
    if (!collCache || collLang !== l) {
      collLang = l;
      try { collCache = new Intl.Collator(l, { numeric: true, sensitivity: 'base' }).compare; } catch (e) { collCache = function (x, y) { return x < y ? -1 : x > y ? 1 : 0; }; }
    }
    return collCache(a, b);
  }
  function setup(root) {
    if (root.ptList) return;
    root.ptList = 1;
    var els = root.querySelectorAll('[data-pt-i]');
    var data = [];
    for (var i = 0; i < els.length; i++) {
      var v = {};
      try { v = JSON.parse(els[i].getAttribute('data-pt-v') || '{}') || {}; } catch (e) { v = {}; }
      data.push({ el: els[i], i: i, s: els[i].getAttribute('data-pt-s') || '', f: ' ' + (els[i].getAttribute('data-pt-f') || '') + ' ', v: v, parent: els[i].parentNode });
    }
    var total = data.length;
    var q = root.querySelector('[data-pt-q]');
    var sel = root.querySelector('[data-pt-sort]');
    var facets = root.querySelectorAll('select[data-pt-facet]');
    var tabs = root.querySelectorAll('[data-pt-tab]');
    var count = root.querySelector('[data-pt-count]');
    var empty = root.querySelector('[data-pt-empty]');
    var more = root.querySelector('[data-pt-more]');
    var reset = root.querySelector('[data-pt-reset]');
    var page = Number(root.getAttribute('data-pt-page')) || 0;
    var shown = page;
    var lastSort = '';
    var timer = 0;
    function tab() {
      for (var k = 0; k < tabs.length; k++) if (tabs[k].getAttribute('aria-pressed') === 'true') return tabs[k].getAttribute('data-pt-tab') || '';
      return '';
    }
    function sortBy(key, dir) {
      var arr = data.slice();
      if (!key) return arr;
      arr.sort(function (a, b) {
        var x = pt.lv(a.v[key]);
        var y = pt.lv(b.v[key]);
        var nx = x == null || x === '';
        var ny = y == null || y === '';
        if (nx || ny) return nx === ny ? a.i - b.i : nx ? 1 : -1;
        var r = typeof x === 'number' && typeof y === 'number' ? x - y : cmp(String(x), String(y));
        if (!r) return a.i - b.i;
        return dir === 'd' ? -r : r;
      });
      return arr;
    }
    function apply(keep) {
      var terms = q ? pt.fold(q.value).split(' ').filter(Boolean) : [];
      var need = [];
      for (var k = 0; k < facets.length; k++) if (facets[k].value) need.push(' ' + facets[k].getAttribute('data-pt-facet') + ':' + facets[k].value + ' ');
      var tb = tab();
      if (tb) need.push(' ' + tb + ' ');
      var active = terms.length > 0 || need.length > 0;
      if (!keep) shown = page;
      var sv = sel ? sel.value : '';
      var order = data;
      if (sv) {
        var p = sv.split(':');
        order = sortBy(p[0], p[1]);
      }
      if (sv !== lastSort) {
        lastSort = sv;
        for (var o = 0; o < order.length; o++) order[o].parent.appendChild(order[o].el);
      }
      var hits = [];
      for (var m = 0; m < order.length; m++) {
        var x = order[m];
        var ok = true;
        for (var a = 0; a < terms.length && ok; a++) if (x.s.indexOf(terms[a]) < 0) ok = false;
        for (var b = 0; b < need.length && ok; b++) if (x.f.indexOf(need[b]) < 0) ok = false;
        if (ok) hits.push(x);
      }
      var vis = {};
      for (var h = 0; h < order.length; h++) order[h].el.hidden = true;
      for (var j = 0; j < hits.length; j++) {
        if (shown && j >= shown) break;
        hits[j].el.hidden = false;
        vis[hits[j].el.id] = 1;
      }
      // Groups (alphabet letters, chapters) without a visible item, and the entries pointing at hidden items.
      var groups = root.querySelectorAll('[data-pt-g]');
      for (var g = 0; g < groups.length; g++) {
        var any = groups[g].querySelector('[data-pt-i]:not([hidden])');
        groups[g].hidden = !any && !!groups[g].querySelector('[data-pt-i]');
        var az = root.querySelector('[data-pt-azl="' + groups[g].id + '"]');
        if (az) { if (groups[g].hidden) az.setAttribute('aria-disabled', 'true'); else az.removeAttribute('aria-disabled'); }
      }
      var fors = root.querySelectorAll('[data-pt-for]');
      for (var f = 0; f < fors.length; f++) fors[f].hidden = active && !vis[fors[f].getAttribute('data-pt-for')];
      if (count) {
        var n = hits.length;
        count.textContent = shown && n > shown ? pt.t('pt.shown', { n: shown, total: n }) : pt.t('pt.count', { n: active ? n : total });
      }
      if (empty) empty.hidden = hits.length > 0;
      if (more) more.hidden = !(shown && hits.length > shown);
      if (reset) reset.hidden = !active;
    }
    if (q) q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { apply(false); }, 120); });
    if (sel) sel.addEventListener('change', function () { apply(false); });
    for (var k = 0; k < facets.length; k++) facets[k].addEventListener('change', function () { apply(false); });
    for (var tt = 0; tt < tabs.length; tt++) {
      tabs[tt].addEventListener('click', function (e) {
        for (var z = 0; z < tabs.length; z++) tabs[z].setAttribute('aria-pressed', tabs[z] === e.currentTarget ? 'true' : 'false');
        apply(false);
      });
    }
    if (more) more.addEventListener('click', function () { shown += page; apply(true); });
    if (reset) {
      reset.addEventListener('click', function () {
        if (q) q.value = '';
        for (var z = 0; z < facets.length; z++) facets[z].value = '';
        for (var y = 0; y < tabs.length; y++) tabs[y].setAttribute('aria-pressed', y === 0 ? 'true' : 'false');
        apply(false);
        if (q) q.focus();
      });
    }
    pt.onLang(function () { apply(true); });
    apply(false);
  }
  pt.add(function (root) {
    var lists = root.querySelectorAll('[data-pt-list]');
    for (var i = 0; i < lists.length; i++) setup(lists[i]);
    if (root.hasAttribute && root.hasAttribute('data-pt-list')) setup(root);
  });
}

/* ---------- unified search ---------- */

// Unified search over the embedded index: folding per language computed once and cached; results are built with DOM
// APIs and textContent (never innerHTML), so indexed text cannot inject markup. Scoring mirrors search.js.
function ptFind(R) {
  var d = document;
  var pt = R.pt;
  var MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
  function foldMap(s) {
    var out = '';
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var f = c;
      try { f = c.normalize('NFKD'); } catch (e) { /* old engine */ }
      f = f.replace(MARKS, '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss');
      for (var k = 0; k < f.length; k++) map.push(i);
      out += f;
    }
    map.push(s.length);
    return { t: out, m: map };
  }
  // Text with <mark> around the folded terms, as DOM nodes appended to el; around the first match when cut.
  function marked(el, text, terms, max) {
    var s = String(text || '');
    var fm = foldMap(s);
    var start = 0;
    if (max && s.length > max) {
      var first = -1;
      for (var a = 0; a < terms.length; a++) { var x = fm.t.indexOf(terms[a]); if (x >= 0 && (first < 0 || x < first)) first = x; }
      if (first > 60) start = fm.m[first - 50] || 0;
      var sp = s.indexOf(' ', start);
      if (start > 0 && sp > 0 && sp - start < 20) start = sp + 1;
      var end = Math.min(s.length, start + max);
      s = (start > 0 ? '… ' : '') + s.slice(start, end) + (end < String(text).length ? ' …' : '');
      fm = foldMap(s);
    }
    var hits = [];
    for (var b = 0; b < terms.length; b++) {
      var i = fm.t.indexOf(terms[b]);
      while (i >= 0 && hits.length < 40) { hits.push([fm.m[i], fm.m[i + terms[b].length]]); i = fm.t.indexOf(terms[b], i + terms[b].length); }
    }
    hits.sort(function (p, q) { return p[0] - q[0]; });
    var pos = 0;
    for (var h = 0; h < hits.length; h++) {
      if (hits[h][0] < pos) continue;
      if (hits[h][0] > pos) el.appendChild(d.createTextNode(s.slice(pos, hits[h][0])));
      var mk = d.createElement('mark');
      mk.textContent = s.slice(hits[h][0], hits[h][1]);
      el.appendChild(mk);
      pos = hits[h][1];
    }
    if (pos < s.length) el.appendChild(d.createTextNode(s.slice(pos)));
  }
  function setup(root) {
    if (root.ptFind) return;
    root.ptFind = 1;
    var ix = {};
    var js = root.querySelector('script[data-pt-ix]');
    try { ix = JSON.parse(js ? js.textContent : '{}') || {}; } catch (e) { ix = {}; }
    var form = root.querySelector('[data-pt-ff]');
    var input = root.querySelector('[data-pt-fq]');
    var tabsBox = root.querySelector('[data-pt-ftabs]');
    var countEl = root.querySelector('[data-pt-fcount]');
    var groupsEl = root.querySelector('[data-pt-fgroups]');
    var res = root.querySelector('[data-pt-fres]');
    var limit = Number(root.getAttribute('data-pt-limit')) || 20;
    var noTabs = root.hasAttribute('data-pt-notabs');
    var cache = {};
    var type = '';
    var timer = 0;
    function docs() {
      var l = pt.lang();
      if (cache[l]) return cache[l];
      var list = ix[l] || ix[Object.keys(ix)[0]] || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var ft = pt.fold(e[1]);
        out.push({ e: e, ft: ft, tw: ' ' + ft + ' ', fx: ' ' + pt.fold(e[2]) + ' ', fs: pt.fold(e[4]) });
      }
      cache[l] = out;
      return out;
    }
    function score(x, terms) {
      var s = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var v = 0;
        if (x.tw.indexOf(' ' + t + ' ') >= 0) v += 30;
        else if (x.tw.indexOf(' ' + t) >= 0) v += 18;
        else if (x.ft.indexOf(t) >= 0) v += 8;
        if (x.fs.indexOf(t) >= 0) v += 3;
        var n = 0;
        var p = x.fx.indexOf(' ' + t);
        while (p >= 0 && n < 12) { n++; p = x.fx.indexOf(' ' + t, p + 1); }
        v += n;
        if (!v) return 0;
        s += v;
      }
      return s;
    }
    function run() {
      var q = input ? input.value : '';
      var terms = pt.fold(q).split(' ').filter(Boolean);
      while (res.firstChild) res.removeChild(res.firstChild);
      while (groupsEl && groupsEl.firstChild) groupsEl.removeChild(groupsEl.firstChild);
      if (!terms.length || pt.fold(q).length < 2) {
        if (tabsBox) tabsBox.hidden = true;
        if (groupsEl) groupsEl.hidden = true;
        if (countEl) countEl.textContent = '';
        return;
      }
      var all = docs();
      var hits = [];
      var counts = {};
      var groups = {};
      var gorder = [];
      for (var i = 0; i < all.length; i++) {
        var sc = score(all[i], terms);
        if (!sc) continue;
        var e = all[i].e;
        counts[e[0]] = (counts[e[0]] || 0) + 1;
        if (e[5]) {
          if (!groups[e[5]]) { groups[e[5]] = { label: e[6], n: 0, href: '' }; gorder.push(e[5]); }
          groups[e[5]].n++;
        }
        hits.push({ x: all[i], s: sc });
      }
      hits.sort(function (a, b) { return b.s - a.s || (a.x.e[1] < b.x.e[1] ? -1 : 1); });
      if (type && !counts[type]) type = '';
      // Tabs: all, then one per type with results.
      if (tabsBox && !noTabs) {
        while (tabsBox.firstChild) tabsBox.removeChild(tabsBox.firstChild);
        var order = ['page', 'act', 'article', 'term', 'person', 'firm', 'org', 'request', 'check'];
        var mk = function (tp, label, n) {
          var b = d.createElement('button');
          b.type = 'button';
          b.setAttribute('data-pt-ft', tp);
          b.setAttribute('aria-pressed', tp === type ? 'true' : 'false');
          b.textContent = label + ' ';
          var c = d.createElement('span');
          c.textContent = String(n);
          b.appendChild(c);
          tabsBox.appendChild(b);
        };
        mk('', pt.t('pt.all'), hits.length);
        for (var o = 0; o < order.length; o++) if (counts[order[o]]) mk(order[o], pt.t('pt.hub.' + order[o]) || order[o], counts[order[o]]);
        tabsBox.hidden = false;
      }
      var shown = type ? hits.filter(function (h) { return h.x.e[0] === type; }) : hits;
      if (countEl) countEl.textContent = shown.length ? pt.t('pt.count', { n: shown.length }) : pt.t('pt.none');
      if (groupsEl && gorder.length && (!type || type === 'article')) {
        var hd = d.createElement('span');
        hd.textContent = pt.t('pt.find.groups') + ': ';
        groupsEl.appendChild(hd);
        for (var g = 0; g < gorder.length; g++) {
          var chip = d.createElement('span');
          chip.setAttribute('data-pt-chip', '');
          chip.textContent = groups[gorder[g]].label + ' · ' + pt.t('pt.find.inArts', { n: groups[gorder[g]].n });
          groupsEl.appendChild(chip);
        }
        groupsEl.hidden = false;
      } else if (groupsEl) groupsEl.hidden = true;
      for (var r = 0; r < shown.length && r < limit; r++) {
        var ent = shown[r].x.e;
        var li = d.createElement('li');
        li.setAttribute('data-pt-type', ent[0]);
        var kind = d.createElement('span');
        kind.setAttribute('data-pt-kind', '');
        kind.textContent = pt.t('pt.hub.' + ent[0]) || ent[0];
        var a = d.createElement('a');
        a.href = ent[3];
        marked(a, ent[1], terms, 0);
        li.appendChild(kind);
        li.appendChild(a);
        if (ent[4]) { var sub = d.createElement('small'); sub.textContent = ent[4]; li.appendChild(sub); }
        if (ent[2]) { var p = d.createElement('p'); marked(p, ent[2], terms, 220); li.appendChild(p); }
        res.appendChild(li);
      }
    }
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(timer); run(); });
    if (input) input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 180); });
    root.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-pt-ft],[data-pt-fs]') : null;
      if (!b || !root.contains(b)) return;
      if (b.hasAttribute('data-pt-fs')) { if (input) input.value = b.getAttribute('data-pt-fs'); type = ''; run(); return; }
      type = b.getAttribute('data-pt-ft') || '';
      run();
    });
    pt.onLang(function () { cache = {}; run(); });
  }
  pt.add(function (root) {
    var list = root.querySelectorAll('[data-pt-find]');
    for (var i = 0; i < list.length; i++) setup(list[i]);
  });
}

/* ---------- checklists: ticks remembered in the browser, progress ---------- */

// Checklist ticks stored as { anchor: 1 } under the block key; anchors are stable across re-exports, so ticks survive site updates.
function ptCheck(R) {
  var pt = R.pt;
  function setup(root) {
    if (root.ptCheck) return;
    root.ptCheck = 1;
    var key = root.getAttribute('data-pt-check');
    var persist = root.hasAttribute('data-pt-persist');
    var boxes = root.querySelectorAll('input[data-pt-ck]');
    var prog = root.querySelector('[data-pt-prog]');
    var text = root.querySelector('[data-pt-progt]');
    var reset = root.querySelector('[data-pt-ck-reset]');
    var state = (persist && pt.get(key)) || {};
    function upd() {
      var n = 0;
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
      if (prog) { prog.max = boxes.length; prog.value = n; }
      if (text) text.textContent = pt.t('pt.ck.progress', { n: n, total: boxes.length });
      root.setAttribute('data-pt-done', n === boxes.length && n ? '1' : '0');
    }
    for (var i = 0; i < boxes.length; i++) {
      var id = boxes[i].getAttribute('data-pt-ck');
      if (state[id]) boxes[i].checked = true;
      boxes[i].addEventListener('change', function (e) {
        var k = e.target.getAttribute('data-pt-ck');
        if (e.target.checked) state[k] = 1; else delete state[k];
        if (persist) pt.set(key, state);
        upd();
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        state = {};
        for (var z = 0; z < boxes.length; z++) boxes[z].checked = false;
        if (persist) pt.set(key, state);
        upd();
      });
    }
    pt.onLang(upd);
    upd();
  }
  pt.add(function (root) {
    var list = root.querySelectorAll('[data-pt-check]');
    for (var i = 0; i < list.length; i++) setup(list[i]);
  });
}

export const PT_FEATURES = { ptbase: ptBase, pttoc: ptToc, pttips: ptTips, ptlist: ptList, ptfind: ptFind, ptcheck: ptCheck };
export const PT_FEATURE_ORDER = ['ptbase', 'pttoc', 'pttips', 'ptlist', 'ptfind', 'ptcheck'];
// Every feature uses R.pt from ptbase; startPortal always runs ptbase first.
export const PT_FEATURE_DEPS = { pttoc: ['ptbase'], pttips: ['ptbase'], ptlist: ['ptbase'], ptfind: ['ptbase'], ptcheck: ['ptbase'] };

// Runs the features on a page (knowledge reader, tests): returns R.pt.
export function startPortal(R, features = PT_FEATURE_ORDER) {
  const set = new Set(features);
  for (const f of PT_FEATURE_ORDER) if (set.has(f) || f === 'ptbase') PT_FEATURES[f](R);
  return R.pt;
}
