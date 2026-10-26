// landing-studio/viewer-runtime-chat.js - runtime feature chat (serialized with Function.prototype.toString
// like viewer-runtime.js; CONTRACT.md §8, §17): chat panels and floating bubbles, the conversation kept in this
// browser, sending and receiving through an external chat API (two configured requests), the built-in backend
// (`local:chat`, routed to api/chat by feature api, long-poll) or "leave a message" (fallback channel / outbox).
// Same rules as every rt* function: only R, locals and browser globals; ES5-ish; texts from cfg.ui; never throws.

// cfg.chat[blockId] = { m: 'ext' | 'api' | 'msg', s: send Req | null, p: poll Req | null, fb, to, n / c: visitor name /
// contact field 'off' | 'optional' | 'required' }. Storage: lp-chat:<docId>:<blockId> = { conv, cur, sent, name,
// contact, msgs: [{id, from: 'visitor'|'operator'|'system', name, text, at, st: ''|'sending'|'fail'}] } (last 100),
// lp-chat-out:<docId> = messages waiting for the backend (outbox of a static page).
//
// Design: local-first. The conversation is persisted before any network call, so a reload, a crash or an offline
// moment never loses what the visitor typed; the server is a sync target, not the source of truth for display.
// Message ids are generated client-side and sent as the idempotency key: a retry after a lost response is
// recognized by the server and, when echoed back, deduplicated here by id (take()).
// Security: message text is always inserted with createTextNode, never innerHTML; operator text is untrusted.
function rtChat(R) {
  var C = R.cfg.chat || {};
  if (!R.req) return;
  var d = document;
  var hop = Object.prototype.hasOwnProperty;
  var site = R.cfg.id || '';
  // Poll back-off ladder after consecutive failures: protects a struggling server and the visitor's battery.
  var BACK = [2000, 5000, 15000, 30000, 60000];
  // Server-supplied ids (message, conversation) must match this before use: they end up in URLs and storage keys.
  var ID = /^[A-Za-z0-9._~-]{1,64}$/;
  var OUT = 'lp-chat-out:' + site;
  var MAX = 100;
  var adopt = {}; // blockId → function (conv): a conversation started by the outbox

  function jget(k, def) {
    var v = null;
    try { v = JSON.parse(R.store.get(k) || 'null'); } catch (e) { v = null; }
    return v && typeof v === 'object' ? v : def;
  }
  // Accepts epoch ms, numeric strings or ISO dates from heterogeneous chat APIs; anything else becomes 'now' so a
  // malformed timestamp cannot sort a message into the past.
  function stamp(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return v;
    if (typeof v === 'string' && v) { var n = /^\d+$/.test(v) ? Number(v) : Date.parse(v); if (isFinite(n) && n > 0) return n; }
    return Date.now();
  }
  function fmtTime(t) {
    var dt = new Date(t);
    var today = new Date().toDateString() === dt.toDateString();
    try {
      var o = today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      return new Intl.DateTimeFormat(R.lang(), o).format(dt);
    } catch (e) { /* plain format below */ }
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return (today ? '' : dt.getDate() + '.' + p(dt.getMonth() + 1) + ' ') + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }
  // The page URL is shared with the operator only for real web pages; file:// paths would leak local folder names.
  function page() { return /^https?:/i.test(location.href) ? location.href : ''; }

  // Messages waiting for the backend (written while the page ran static): flushed when the API answers.
  var outbox = {
    all: function () { var a = jget(OUT, []); return Array.isArray(a) ? a : []; },
    put: function (a) { if (a.length) R.store.set(OUT, JSON.stringify(a.slice(-30))); else R.store.del(OUT); },
  };

  function setup(box) {
    var id = box.getAttribute('data-lp-chat') || '';
    var cf = hop.call(C, id) && C[id] && typeof C[id] === 'object' ? C[id] : {};
    var mode = cf.m === 'ext' || cf.m === 'api' ? cf.m : 'msg';
    var KEY = 'lp-chat:' + site + ':' + id;
    var log = box.querySelector('[data-lp-chat-log]');
    var form = box.querySelector('[data-lp-chat-form]');
    var input = box.querySelector('[data-lp-chat-in]');
    var stEl = box.querySelector('[data-lp-chat-st]');
    var off = box.querySelector('[data-lp-chat-off]');
    var fbBox = box.querySelector('[data-lp-chat-fb]');
    var who = box.querySelector('[data-lp-chat-who]');
    var btn = box.querySelector('[data-lp-chat-submit]');
    var pop = box.classList.contains('lp-chat-pop');
    var wrap = pop ? box.parentNode : null;
    var fab = wrap ? wrap.querySelector('[data-lp-chat-open]') : null;
    var badge = wrap ? wrap.querySelector('[data-lp-chat-badge]') : null;
    if (!log || !form || !input) return;
    var opEl = box.querySelector('.lp-chat-op');
    var tEl = box.querySelector('.lp-chat-t');
    var opName = String((opEl && opEl.textContent) || (tEl && tEl.textContent) || '').trim();
    var S = jget(KEY, {});
    if (!Array.isArray(S.msgs)) S.msgs = [];
    var open = !pop;
    var unread = 0;
    var timer = 0;
    var polling = false;
    var fails = 0;
    var dead = false;

    function save() {
      S.msgs = S.msgs.slice(-MAX);
      R.store.set(KEY, JSON.stringify(S));
    }
    function find(mid) {
      for (var i = 0; i < S.msgs.length; i++) if (S.msgs[i].id === mid) return S.msgs[i];
      return null;
    }
    function status(state, text) {
      if (!stEl) return;
      stEl.setAttribute('data-state', state || '');
      stEl.textContent = text || '';
      stEl.hidden = !text;
    }
    function dot(on) { box.setAttribute('data-lp-chat-state', on ? 'on' : 'off'); }
    function bottom() { try { log.scrollTop = log.scrollHeight; } catch (e) { /* ignore */ } }

    // One message row: sender for screen readers, text (textContent only), time, retry for a failed message.
    function row(m) {
      var me = m.from === 'visitor';
      var sys = m.from === 'system';
      var el = R.el('div', 'lp-chat-msg ' + (me ? 'lp-chat-me' : sys ? 'lp-chat-sys' : 'lp-chat-them') + (m.st === 'fail' ? ' lp-chat-fail' : ''));
      el.setAttribute('data-mid', m.id);
      var bub = R.el('div', 'lp-chat-bub');
      if (!sys) bub.appendChild(R.el('span', 'lp-sr', (me ? R.t('chatYou') : m.name || opName) + ': '));
      bub.appendChild(d.createTextNode(m.text));
      el.appendChild(bub);
      if (!sys) {
        var meta = m.st === 'sending' ? R.t('chatSending') : (!me && m.name ? m.name + ' · ' : '') + fmtTime(m.at);
        el.appendChild(R.el('span', 'lp-chat-meta', meta));
      }
      if (m.st === 'fail') {
        var rb = R.el('button', 'lp-chat-retry', R.t('chatRetry'));
        rb.type = 'button';
        rb.addEventListener('click', function () { send(m, true); });
        el.appendChild(rb);
      }
      return el;
    }
    // Full repaint only on start-up and cross-tab sync; single messages go through update() to keep scroll and focus.
    function paint() {
      R.$$('[data-mid]', log).forEach(function (x) { x.parentNode.removeChild(x); });
      S.msgs.forEach(function (m) { log.appendChild(row(m)); });
      bottom();
    }
    function update(m) {
      var old = null;
      R.$$('[data-mid]', log).some(function (x) { if (x.getAttribute('data-mid') === m.id) { old = x; return true; } return false; });
      var el = row(m);
      if (old) log.replaceChild(el, old); else log.appendChild(el);
      bottom();
    }
    function add(m) {
      var have = find(m.id);
      if (have) { have.st = m.st; have.text = m.text; update(have); return have; }
      S.msgs.push(m);
      update(m);
      return m;
    }
    function system(text) { add({ id: 's' + R.rnd(10), from: 'system', text: text, at: Date.now(), st: '' }); save(); }

    function badgeSync() {
      if (!badge || !fab) return;
      badge.textContent = String(unread);
      badge.hidden = !unread;
      var label = R.t('chatOpen') + (unread ? ', ' + R.t('chatUnread', { n: unread }) : '');
      fab.setAttribute('aria-label', label);
    }
    // Messages from the API: {messages: [{id, from, name, text, at}], cursor} (or a bare array); own messages echo back.
    // Unknown senders default to 'operator' (never 'visitor'), so a malformed API reply cannot impersonate the visitor
    // in the transcript. Lengths are clamped as on input.
    function take(data) {
      var list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.messages) ? data.messages : [];
      var news = 0;
      var last = '';
      list.forEach(function (x) {
        if (!x || typeof x !== 'object' || typeof x.text !== 'string' || !x.text) return;
        var mid = x.id != null && ID.test(String(x.id)) ? String(x.id) : '';
        var known = mid ? find(mid) : null;
        if (known) {
          if (known.st) { known.st = ''; update(known); }
          return;
        }
        var from = x.from === 'visitor' || x.from === 'system' ? x.from : 'operator';
        var m = { id: mid || 'r' + R.rnd(10), from: from, name: typeof x.name === 'string' ? x.name.slice(0, 80) : '', text: x.text.slice(0, 4000), at: stamp(x.at), st: '' };
        S.msgs.push(m);
        update(m);
        if (from === 'operator') { news++; last = m.name || opName; }
      });
      if (data && typeof data === 'object' && !Array.isArray(data) && (typeof data.cursor === 'number' || typeof data.cursor === 'string')) S.cur = data.cursor;
      save();
      if (news && (!open || d.hidden)) {
        unread += news;
        badgeSync();
        R.live(R.t('chatNew', { name: last }));
      }
    }
    // Server cursor when the API provides one (exact), else the newest message time (may re-fetch a boundary message;
    // id dedup in take() absorbs that).
    function since() {
      if (S.cur != null && S.cur !== '') return S.cur;
      var t = 0;
      S.msgs.forEach(function (m) { if (m.from !== 'system' && m.at > t) t = m.at; });
      return t;
    }
    // A configured request with {conv} and {since} filled in (URL-encoded in the URL, raw in headers).
    function sub(q) {
      if (!q) return null;
      var cv = S.conv || '';
      var sn = String(since());
      var u = String(q.u || '').replace(/\{conv\}/g, encodeURIComponent(cv)).replace(/\{since\}/g, encodeURIComponent(sn));
      var hs = {};
      var h0 = q.h && typeof q.h === 'object' ? q.h : {};
      // Headers get raw values: percent-encoding is a URL concept and would corrupt e.g. a conversation token header.
      for (var k in h0) if (hop.call(h0, k)) hs[k] = String(h0[k]).replace(/\{conv\}/g, cv).replace(/\{since\}/g, sn);
      return { m: q.m, u: u, h: hs, c: q.c, t: q.t, r: q.r };
    }

    // A backend page served by a static host (R.req answers error 'static') switches permanently to 'leave a message'.
    function degrade() {
      mode = 'msg';
      clearTimeout(timer);
      if (off) off.hidden = false;
      dot(false);
    }

    function poll(now) {
      clearTimeout(timer);
      if (dead || mode === 'msg' || polling) return;
      if (mode === 'api' && !S.conv) return;
      if (mode === 'ext' && (!cf.p || !(S.conv || S.sent))) return;
      // api: long-poll (the server holds the request up to 25 s), so re-arming quickly costs nothing. ext: short polls,
      // slower when the panel is closed or the tab hidden.
      var wait = now ? 30 : mode === 'api' ? 400 : open && !d.hidden ? 4000 : 20000;
      if (fails && !now) wait = BACK[Math.min(fails - 1, BACK.length - 1)];
      timer = setTimeout(run, wait);
    }
    function run() {
      if (polling || mode === 'msg') return;
      polling = true;
      var p = mode === 'api'
        ? R.req({ m: 'GET', u: 'local:chat/' + encodeURIComponent(S.conv), t: 32000, r: 0 }, {}, undefined, { query: 'since=' + encodeURIComponent(String(S.cur || 0)) + '&wait=25' })
        : R.req(sub(cf.p), { form: id });
      // A 404 for a conversation means the server forgot it (data reset): drop it and start fresh on the next send.
      p.then(function (r) {
        polling = false;
        if (r.ok) { fails = 0; dot(true); take(r.data); } else if (r.error === 'static') { degrade(); return; } else if (mode === 'api' && r.status === 404) {
          S.conv = '';
          S.cur = 0;
          save();
          return;
        } else { fails++; dot(false); }
        poll(false);
      });
    }

    // Visitor fields: required ones filled, a contact that looks like an e-mail address or a phone number.
    function checkWho() {
      if (!who || who.hidden) return true;
      var first = null;
      R.$$('input', who).forEach(function (el) {
        var v = String(el.value || '').trim();
        var msg = '';
        if (el.required && !v) msg = R.t('fieldRequired');
        else if (v && el.name === 'contact' && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.replace(/\D/g, '').length >= 5)) msg = R.t('fieldInvalid');
        var er = el.getAttribute('aria-describedby') ? d.getElementById(el.getAttribute('aria-describedby')) : null;
        if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
        if (er) { er.textContent = msg; er.hidden = !msg; }
        if (msg && !first) first = el;
        if (!msg) S[el.name === 'contact' ? 'contact' : 'name'] = v.slice(0, 200);
      });
      if (first) { R.live(R.t('formErrors')); try { first.focus(); } catch (e) { /* ignore */ } return false; }
      return true;
    }
    function whoDone() { if (who && S.sent) who.hidden = true; }

    function body(m) {
      return {
        site: site, conv: S.conv || null, lang: R.lang(), page: page(),
        visitor: { name: S.name || '', contact: S.contact || '' },
        message: { id: m.id, text: m.text, at: m.at },
      };
    }
    // Plain text of a left message for the fallback channels.
    function plain(m) {
      var out = [m.text, ''];
      if (S.name) out.push(R.t('chatName') + ': ' + S.name);
      if (S.contact) out.push(R.t('chatContact') + ': ' + S.contact);
      if (page()) out.push(page());
      return out.join('\n');
    }
    // "Leave a message": the outbox of a backend page that runs static, or a channel (mailto / WhatsApp / Telegram).
    function leave(m, gesture) {
      var fb = cf.fb;
      if (fb === 'outbox' && R.api) {
        var a = outbox.all().filter(function (x) { return x && x.b && x.b.message && x.b.message.id !== m.id; });
        a.push({ bid: id, b: body(m) });
        outbox.put(a);
        m.st = '';
        S.sent = true;
        update(m);
        save();
        whoDone();
        system(R.t('chatQueued'));
        return;
      }
      var url = R.fk && (fb === 'mailto' || fb === 'whatsapp' || fb === 'telegram') ? R.fk.link(fb, cf.to, plain(m), d.title) : '';
      if (!url) { m.st = 'fail'; update(m); save(); status('err', R.t('chatFailed')); return; }
      m.st = '';
      S.sent = true;
      update(m);
      save();
      whoDone();
      var go = function () {
        if (fb === 'telegram') R.fk.copy(plain(m), box).then(function (ok) { status(ok ? '' : 'err', ok ? R.t('coPaste') : R.t('coCopyFail')); });
        R.fk.go(url);
      };
      // Popup blockers allow window.open / navigation only inside a user-gesture task (click, keypress).
      if (gesture) { go(); system(R.t('chatDirect')); return; }
      // Without a user gesture a new window would be blocked: offer the channel as a button.
      if (fbBox) {
        fbBox.textContent = '';
        var label = fb === 'mailto' ? 'sendByEmail' : fb === 'whatsapp' ? 'sendWhatsApp' : 'sendTelegram';
        var b = R.el('button', 'lp-btn lp-btn-secondary lp-btn-sm', R.t(label));
        b.type = 'button';
        b.addEventListener('click', function () { go(); fbBox.hidden = true; system(R.t('chatDirect')); });
        fbBox.appendChild(b);
        fbBox.hidden = false;
      }
    }
    function send(m, gesture) {
      m.st = 'sending';
      update(m);
      status('', '');
      if (mode === 'msg') { leave(m, gesture); return; }
      var q = mode === 'api' ? { m: 'POST', u: 'local:chat', t: 12000, r: 1 } : sub(cf.s);
      if (btn) btn.disabled = true;
      R.req(q, { key: m.id, form: id }, body(m)).then(function (r) {
        if (btn) btn.disabled = false;
        if (!r.ok && r.error === 'static') { degrade(); leave(m, false); return; }
        if (!r.ok) { m.st = 'fail'; update(m); save(); status('err', R.t('chatFailed')); R.live(R.t('chatFailed')); return; }
        var data = r.data && typeof r.data === 'object' ? r.data : {};
        if (typeof data.conv === 'string' && ID.test(data.conv)) S.conv = data.conv;
        m.st = '';
        S.sent = true;
        update(m);
        take(data);
        whoDone();
        dot(true);
        fails = 0;
        poll(true);
      });
    }
    function submit() {
      var text = String(input.value || '').replace(/^\s+|\s+$/g, '');
      if (!text) { try { input.focus(); } catch (e) { /* ignore */ } return; }
      if (!checkWho()) return;
      var m = { id: 'v' + R.rnd(12), from: 'visitor', name: '', text: text.slice(0, 4000), at: Date.now(), st: 'sending' };
      input.value = '';
      grow();
      add(m);
      save();
      send(m, true);
    }
    function grow() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight + 2, 160) + 'px';
    }
    function setOpen(on) {
      if (!pop) return;
      open = on;
      box.hidden = !on;
      if (fab) fab.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) {
        unread = 0;
        badgeSync();
        bottom();
        var target = null;
        if (who && !who.hidden) R.$$('input', who).some(function (el) { if (el.required && !el.value) { target = el; return true; } return false; });
        try { (target || input).focus(); } catch (e) { /* ignore */ }
        if (mode === 'ext') poll(true);
      } else if (fab) {
        try { fab.focus(); } catch (e) { /* ignore */ }
      }
    }

    // Wiring.
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    input.addEventListener('keydown', function (e) {
      // isComposing: Enter that commits an IME composition (Japanese, Chinese input) must not send the message.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', grow);
    if (who) {
      R.$$('input', who).forEach(function (el) {
        var v = el.name === 'contact' ? S.contact : S.name;
        if (typeof v === 'string') el.value = v;
      });
      whoDone();
    }
    if (fab) {
      fab.addEventListener('click', function () { setOpen(box.hidden); });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      });
      R.$$('[data-lp-chat-close]', box).forEach(function (b) { b.addEventListener('click', function () { setOpen(false); }); });
      badgeSync();
    }
    // The storage event fires in other tabs only: keeps several open tabs of the site showing one conversation.
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      S = jget(KEY, {});
      if (!Array.isArray(S.msgs)) S.msgs = [];
      paint();
    });
    d.addEventListener('visibilitychange', function () { if (!d.hidden && mode === 'ext') poll(true); });
    adopt[id] = function (cv) { if (!S.conv) { S.conv = cv; save(); poll(true); } };
    paint();
    dot(mode !== 'msg');
    if (mode === 'api') {
      if (!R.api) degrade();
      else R.api.ready(function (on) { if (on) { dot(true); flush(); poll(true); } else degrade(); });
    } else if (mode === 'ext') poll(true);
  }

  // Outbox of a static page: sent through the backend as soon as it answers (any chat block of the page).
  var flushing = false;
  function flush() {
    if (flushing) return;
    var a = outbox.all();
    if (!a.length) return;
    flushing = true;
    (function next(i) {
      if (i >= a.length) { flushing = false; outbox.put([]); return; }
      R.req({ m: 'POST', u: 'local:chat', t: 12000, r: 1 }, { key: a[i].b.message && a[i].b.message.id }, a[i].b).then(function (r) {
        // Stop on transient failures and keep the rest for later; a 4xx is permanent for that message, so it is
        // dropped instead of blocking the queue forever.
        if (!r.ok && !(r.error === 'http' && r.status >= 400 && r.status < 500)) { flushing = false; outbox.put(a.slice(i)); return; }
        if (r.ok && r.data && typeof r.data.conv === 'string' && ID.test(r.data.conv) && hop.call(adopt, a[i].bid)) adopt[a[i].bid](r.data.conv);
        next(i + 1);
      });
    })(0);
  }

  R.$$('[data-lp-chat]').forEach(function (box) {
    try { setup(box); } catch (e) { /* one broken chat never stops the others */ }
  });
}

export {
  rtChat
};
