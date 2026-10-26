// landing-studio/viewer-runtime-d.js - runtime features of the part D blocks (viewer-blocks-d.js) and of the
// extended stats / logos blocks, serialized with Function.prototype.toString like viewer-runtime.js: only R, locals and
// browser globals; ES5-ish; no UI text (labels are pre-rendered or come from cfg.ui through R.t); never throws.
//   carousel   [data-lp-car]: previous / next, dots, autoplay (paused on hover / focus / hidden tab / off screen,
//              off with prefers-reduced-motion until the visitor presses play), loop, RTL; swipe and keyboard are the
//              native scrolling of the track
//   tabs       [data-lp-tabs]: WAI-ARIA tabs (roving tabindex; arrows, Home, End)
//   counter    [data-lp-count]: numbers count up once when they come into view (not with reduced motion)
//   ba         [data-lp-ba]: before / after position from the range input
//   announce   [data-lp-ann]: dismissible bar, remembered per text (lp-ann:<docId>:<blockId>)
//   countdown  [data-lp-cd]: days / hours / minutes / seconds to a moment, then the "done" text
//   video      [data-lp-vid]: the external player is created only after the click on play
//   marquee    [data-lp-mq]: pause / play button of the moving logo strip
//
// Shared stance: the markup already works without these functions (see viewer-blocks-d.js); each one only enhances.
// Motion obeys prefers-reduced-motion through R.reduce(): autoplay starts paused, counters do not animate, smooth
// scrolling becomes instant. WCAG 2.2.2 requires a pause control for anything moving longer than 5 s, hence the pause
// buttons on the carousel and the marquee.

function rtCarousel(R) {
  var d = document;
  R.$$('[data-lp-car]').forEach(function (box) {
    var track = box.querySelector('[data-lp-car-track]');
    if (!track) return;
    var slides = R.$$('.lp-car-slide', track);
    var n = slides.length;
    if (n < 2) { box.classList.add('lp-car-one'); return; }
    var dots = R.$$('[data-lp-car-dot]', box);
    var prev = box.querySelector('[data-lp-car-go="prev"]');
    var next = box.querySelector('[data-lp-car-go="next"]');
    var pauseBtn = box.querySelector('[data-lp-car-pause]');
    var loop = box.hasAttribute('data-lp-car-loop');
    var secs = Number(box.getAttribute('data-lp-car-auto')) || 0;
    var rtl = function () { return getComputedStyle(track).direction === 'rtl'; };
    // Offset of a slide from the track's start edge (negative = before it).
    // Measured from layout rects at call time instead of cached widths: slides-per-view change with container
    // queries, and RTL flips the axis, so cached offsets would go stale.
    function off(el) {
      var t = track.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      return rtl() ? t.right - r.right : r.left - t.left;
    }
    // The current slide is the one nearest the start edge: derived from scroll position, so swipes, wheel and keyboard
    // scrolling (which bypass our buttons) keep dots and buttons correct with no extra state.
    function current() {
      var best = 0;
      var min = Infinity;
      for (var i = 0; i < n; i++) {
        var o = Math.abs(off(slides[i]));
        if (o < min) { min = o; best = i; }
      }
      return best;
    }
    function perView() {
      var w = slides[0].getBoundingClientRect().width || 1;
      return Math.max(1, Math.round(track.clientWidth / w));
    }
    // Math.abs: in RTL, scrollLeft is 0 at the start and negative toward the end (current spec); the 2px slack absorbs
    // sub-pixel rounding of fractional slide widths.
    function atEnd() { return Math.abs(track.scrollLeft) >= track.scrollWidth - track.clientWidth - 2; }
    // Navigation by scrollBy(delta to the target slide) rather than scrollTo(absolute): the delta from rects is
    // direction-agnostic once sign-corrected for RTL, avoiding the browsers' historic RTL scrollLeft inconsistencies.
    // Looping wraps to the first slide only when already at the end, so 'next' first reaches the last full view.
    function go(i, smooth) {
      var last = n - perView();
      if (i > last) i = loop && i > last ? (current() >= last || atEnd() ? 0 : last) : last;
      if (i < 0) i = loop ? last : 0;
      var dx = off(slides[i]);
      if (rtl()) dx = -dx;
      try { track.scrollBy({ left: dx, behavior: smooth && !R.reduce() ? 'smooth' : 'auto' }); } catch (e) { track.scrollLeft += dx; }
    }
    function update() {
      var c = current();
      dots.forEach(function (b, k) {
        if (k === c) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      var end = atEnd();
      if (prev) prev.setAttribute('aria-disabled', !loop && c === 0 && Math.abs(track.scrollLeft) < 2 ? 'true' : 'false');
      if (next) next.setAttribute('aria-disabled', !loop && end ? 'true' : 'false');
      box.classList[track.scrollWidth - track.clientWidth > 2 ? 'remove' : 'add']('lp-car-one');
    }
    if (prev) prev.addEventListener('click', function () { if (prev.getAttribute('aria-disabled') !== 'true') go(current() - 1, true); });
    if (next) next.addEventListener('click', function () { if (next.getAttribute('aria-disabled') !== 'true') go(current() + 1, true); });
    dots.forEach(function (b) {
      b.addEventListener('click', function () { go(Number(b.getAttribute('data-lp-car-dot')) || 0, true); });
    });
    // Scroll events fire per frame or faster; rAF coalescing keeps update() (which reads layout) to once per frame.
    var raf = 0;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = (window.requestAnimationFrame || setTimeout)(function () { raf = 0; update(); });
    }, { passive: true });
    window.addEventListener('resize', update);
    // Autoplay: only while visible, not hovered or focused, the tab shown and not paused by the visitor.
    if (secs > 0) {
      var paused = R.reduce();
      var hover = false;
      var focus = false;
      var seen = true;
      var setP = function (p) {
        paused = p;
        if (pauseBtn) pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
      };
      setP(paused);
      if (pauseBtn) pauseBtn.addEventListener('click', function () { setP(!paused); });
      box.addEventListener('mouseenter', function () { hover = true; });
      box.addEventListener('mouseleave', function () { hover = false; });
      box.addEventListener('focusin', function () { focus = true; });
      box.addEventListener('focusout', function (e) { if (!box.contains(e.relatedTarget)) focus = false; });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { seen = es[0].isIntersecting; }, { threshold: 0.3 }).observe(box);
      }
      // One interval polling the pause conditions instead of starting/stopping timers on each event: fewer edge
      // cases (overlapping hover + focus + visibility), at the cost of a tick that may be skipped. !box.offsetParent
      // detects a carousel inside a hidden page or tab panel.
      setInterval(function () {
        if (paused || hover || focus || !seen || d.hidden || !box.offsetParent) return;
        if (!loop && atEnd()) { setP(true); return; }
        go(current() + 1, true);
      }, Math.max(2, secs) * 1000);
    }
    update();
    // A page switch in a multi-page export reveals carousels that were display:none (zero rects at init).
    R.on('lp:page', update);
  });
}

function rtTabs(R) {
  R.$$('[data-lp-tabs]').forEach(function (box) {
    var list = box.querySelector('[role=tablist]');
    if (!list) return;
    var tabs = R.$$('[role=tab]', list);
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });
    var vert = list.getAttribute('aria-orientation') === 'vertical';
    function sel(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (panels[k]) { if (on) panels[k].removeAttribute('hidden'); else panels[k].setAttribute('hidden', ''); }
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, k) { t.addEventListener('click', function () { sel(k, false); }); });
    list.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      // In RTL the visual 'next' is ArrowLeft; APG asks arrows to follow visual order.
      var rtl = getComputedStyle(list).direction === 'rtl';
      var f = vert ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
      var b = vert ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
      var j = -1;
      if (e.key === f) j = (i + 1) % tabs.length;
      else if (e.key === b) j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      sel(j, true);
    });
    var first = 0;
    tabs.forEach(function (t, k) { if (t.getAttribute('aria-selected') === 'true') first = k; });
    sel(first, false);
  });
}

function rtCounter(R) {
  var els = R.$$('[data-lp-count]');
  if (!els.length || R.reduce() || !('IntersectionObserver' in window)) return;
  // '1 200', '4.9', '12,5', '98%' → { pre, num, dec (decimals), sep (thousands), dot (decimal mark), post }.
  // The author's own formatting is reproduced during the animation (separator, decimal mark, prefix/suffix), so the
  // count-up never flickers into a different locale's format. Heuristic: a trailing [.,] followed by 1-2 digits is a
  // decimal mark; exactly 3 digits after it is read as a thousands group ('1,200' is 1200, not 1.2).
  function parse(s) {
    var m = /^([^\d]*?)(\d[\d\s  .,']*\d|\d)(.*)$/.exec(s);
    if (!m) return null;
    var raw = m[2];
    var dot = '';
    var dm = /[.,](\d{1,2})$/.exec(raw);
    if (dm && !/[.,]\d{3}$/.test(raw)) dot = raw.charAt(raw.length - dm[1].length - 1);
    var sepm = /\d([\s  .,'])\d{3}(?:\D|$)/.exec(dot ? raw.slice(0, raw.length - dm[1].length - 1) : raw);
    var digits = raw.replace(/[^\d]/g, '');
    var dec = dot ? dm[1].length : 0;
    var num = Number(digits) / Math.pow(10, dec);
    return isFinite(num) ? { pre: m[1], num: num, dec: dec, sep: sepm ? sepm[1] : '', dot: dot || '.', post: m[3] } : null;
  }
  function fmt(p, v) {
    var s = v.toFixed(p.dec);
    var parts = s.split('.');
    var ip = p.sep ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, p.sep) : parts[0];
    return p.pre + ip + (parts[1] ? p.dot + parts[1] : '') + p.post;
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      var el = en.target;
      var end = el.getAttribute('data-lp-count-v') || el.textContent;
      var p = parse(end);
      if (!p) { el.textContent = end; return; }
      var t0 = 0;
      var dur = 1400;
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        // Ease-out cubic: fast start, gentle landing on the final value; the last frame writes the original text
        // verbatim, so rounding during the animation can never leave a wrong final number.
        var e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? fmt(p, p.num * e) : end;
        if (k < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  els.forEach(function (el) {
    var p = parse(el.textContent);
    if (!p) return;
    el.setAttribute('data-lp-count-v', el.textContent);
    // Below the fold the number starts at zero and counts up when it is seen.
    if (el.getBoundingClientRect().top > window.innerHeight) el.textContent = fmt(p, 0);
    io.observe(el);
  });
}

function rtBa(R) {
  R.$$('[data-lp-ba]').forEach(function (b) {
    var r = b.querySelector('input[type=range]');
    if (!r) return;
    var set = function () { b.style.setProperty('--lp-ba', r.value + '%'); };
    r.addEventListener('input', set);
    set();
  });
}

function rtAnnounce(R) {
  var id = (R.cfg && R.cfg.id) || '';
  R.$$('[data-lp-ann]').forEach(function (a) {
    var key = 'lp-ann:' + id + ':' + a.getAttribute('data-lp-ann');
    // Remembered value is the text signature: editing the announcement shows it again to visitors who dismissed it.
    var sig = a.getAttribute('data-lp-ann-v') || '1';
    var wrap = a.closest('.lp-b') || a;
    if (R.store.get(key) === sig) { wrap.setAttribute('hidden', ''); return; }
    var x = a.querySelector('[data-lp-ann-x]');
    if (!x) return;
    x.addEventListener('click', function () {
      R.store.set(key, sig);
      wrap.setAttribute('hidden', '');
      // Focus goes on to the page instead of the removed button.
      var m = document.querySelector('.lp-root>main:not([hidden])');
      if (m) { if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1'); try { m.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    });
  });
}

function rtCountdown(R) {
  R.$$('[data-lp-cd]').forEach(function (el) {
    // Target is an absolute instant (ISO with offset from the exporter); Date.now() differences are immune to the
    // visitor's time zone. Without seconds a 30 s tick is enough and saves battery.
    var t = Date.parse(el.getAttribute('data-lp-cd'));
    if (isNaN(t)) return;
    var units = (el.getAttribute('data-lp-cd-u') || 'dhms').split('');
    var K = { d: 'cdD', h: 'cdH', m: 'cdM', s: 'cdS' };
    var D = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    var nums = {};
    var labs = {};
    units.forEach(function (u) {
      nums[u] = el.querySelector('[data-lp-cd-n="' + u + '"]');
      labs[u] = el.querySelector('[data-lp-cd-l="' + u + '"]');
    });
    var done = el.querySelector('[data-lp-cd-done]');
    var timer = 0;
    function tick() {
      var ms = t - Date.now();
      if (ms <= 0) {
        el.classList.add('lp-cd-over');
        if (done) done.removeAttribute('hidden');
        units.forEach(function (u) { if (nums[u]) nums[u].textContent = '0'; });
        clearInterval(timer);
        return;
      }
      units.forEach(function (u, i) {
        // The first unit carries everything above it (e.g. 400 days); the others wrap.
        var v = Math.floor(ms / D[u]);
        if (i) v = u === 'h' ? v % 24 : v % 60;
        if (nums[u]) nums[u].textContent = i && v < 10 ? '0' + v : String(v);
        if (labs[u]) { var s = R.t(K[u], { n: v }); if (s) labs[u].textContent = s; }
      });
    }
    tick();
    timer = setInterval(tick, units.indexOf('s') >= 0 ? 1000 : 30000);
    R.on('lp:lang', tick);
  });
}

function rtVideo(R) {
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-lp-vid-play]') : null;
    if (!b) return;
    var box = b.closest('[data-lp-vid]');
    var src = box ? box.getAttribute('data-lp-vid') || '' : '';
    // Re-validate the URL at click time: data attributes can be edited in the DOM, and only https embeds are allowed.
    if (!/^https:\/\/[^\s"'<>]+$/.test(src)) return;
    e.preventDefault();
    var f = document.createElement('iframe');
    f.className = 'lp-vid-frame';
    f.src = src + (src.indexOf('?') < 0 ? '?' : '&') + 'autoplay=1';
    f.title = box.getAttribute('data-lp-vid-title') || b.getAttribute('aria-label') || '';
    f.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    f.setAttribute('allowfullscreen', '');
    // Cross-origin the host gets only the page origin (some players refuse to run with no referrer), never the
    // full page URL.
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    var area = box.querySelector('.lp-vid-box') || box;
    area.textContent = '';
    area.appendChild(f);
    try { f.focus(); } catch (x) { /* ignore */ }
  });
}

function rtMarquee(R) {
  R.$$('[data-lp-mq]').forEach(function (box) {
    var b = box.querySelector('[data-lp-mq-pause]');
    if (!b) return;
    if (R.reduce()) { b.setAttribute('hidden', ''); return; }
    b.addEventListener('click', function () {
      var p = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', p ? 'true' : 'false');
      box.classList[p ? 'add' : 'remove']('lp-mq-paused');
    });
  });
}

export {
  rtAnnounce,
  rtBa,
  rtCarousel,
  rtCountdown,
  rtCounter,
  rtMarquee,
  rtTabs,
  rtVideo
};
