// site-studio/backend-admin.js - the admin console of a backend export (served by backend-server.js at
// /admin/, CONTRACT.md §16): sign-in with the admin token, inbox of every private collection (form submissions,
// orders, carts) with CSV / JSON export and delete, chat conversations with replies, schema-driven editing of the
// public content collections (items of the bound list blocks: per-language texts, rich text, files, options), and the
// site actions (rebuild, static snapshot, project file).
//
//   adminHTML({ nonce, name }) -> the page (inline style and script carry the CSP nonce)
//
// The page script is adminApp serialized with Function.prototype.toString: it may use only its own locals and browser
// globals; data reaches the DOM through textContent (rich text only as the server's sanitized HTML).
//
// Why a serialized function and not a bundled script: the console must be one self-contained HTML response under a
// strict nonce CSP (no external script URL to allow, no build step on the server). Writing it as a real function
// keeps it linted and syntax-checked; toString() turns it into the inline script. Consequences: ES5 only (it runs as
// written, untranspiled), no imports, no closures over this module, and the text '</script' must not appear in it
// (adminHTML escapes it defensively anyway).
// Security model of the page: data enters the DOM via textContent / the h() helper only; the single innerHTML use is
// rich text that the server sanitized (backend-server.js cleanItems) before sending.
import { escapeAttr, escapeHTML } from '../html/escape.js';

// Console stylesheet (a template literal, so it carries no comments of its own). Own token set (--bg, --panel, --accent,
// --danger...) redefined under prefers-color-scheme: dark; system font stack with Noto Sans Georgian for Georgian
// sites; single-class selectors throughout; one !important on [hidden] so component display rules cannot unhide
// elements; a single 820px breakpoint turns the sidebar grid into a top scroller.
const ADMIN_CSS = `
:root{--bg:#f4f6f8;--panel:#fff;--panel2:#f8fafc;--text:#17202b;--muted:#5d6876;--border:#dfe4ea;--accent:#2457d6;--accent-w:rgba(36,87,214,.1);--danger:#c62828;--ok:#1b7f3b;--r:10px;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#101318;--panel:#171b22;--panel2:#1d222b;--text:#e6e9ee;--muted:#9aa4b1;--border:#2b323d;--accent:#7aa2ff;--accent-w:rgba(122,162,255,.14);--danger:#ff7b72;--ok:#57d38c}}
*{box-sizing:border-box}
html,body,#app{margin:0;height:100%}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",sans-serif;background:var(--bg);color:var(--text)}
button,input,select,textarea{font:inherit;color:inherit}
a{color:var(--accent)}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:6px 14px;border:1px solid var(--border);border-radius:8px;background:var(--panel);cursor:pointer;text-decoration:none;color:var(--text);white-space:nowrap}
.btn:hover{border-color:var(--accent)}
.btn:focus-visible,.nav a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[contenteditable]:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.btn-p{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.btn-p{color:#0d1117}}
.btn-d{color:var(--danger)}
.btn-s{min-height:30px;padding:3px 10px;font-size:13px}
.btn:disabled{opacity:.55;cursor:default}
.in{width:100%;min-height:38px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
textarea.in{min-height:80px;resize:vertical}
.login{display:grid;place-items:center;min-height:100%;padding:20px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:20px}
.login .card{width:min(420px,100%)}
.login h1{margin:0 0 6px;font-size:20px}
.muted{color:var(--muted)}
.err{color:var(--danger)}
.app{display:grid;grid-template-columns:240px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);height:100%}
.top{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--border)}
.top h1{margin:0;font-size:16px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav{overflow:auto;padding:12px 8px;background:var(--panel2);border-right:1px solid var(--border)}
.nav h2{margin:14px 10px 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.nav a{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;color:var(--text);text-decoration:none}
.nav a:hover{background:var(--accent-w)}
.nav a[aria-current=page]{background:var(--accent-w);color:var(--accent);font-weight:600}
.nav .n{margin-inline-start:auto;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.nav .u{margin-inline-start:auto;min-width:20px;padding:0 6px;border-radius:99px;background:var(--danger);color:#fff;font-size:12px;text-align:center}
.main{overflow:auto;padding:20px}
.head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:16px}
.head h2{margin:0;flex:1;min-width:200px;font-size:20px}
.list{display:flex;flex-direction:column;gap:10px}
.rec{background:var(--panel);border:1px solid var(--border);border-radius:var(--r)}
.rec>summary{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;padding:12px 14px;cursor:pointer;list-style:none}
.rec>summary::-webkit-details-marker{display:none}
.rec time{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.rec .sum{flex:1;min-width:200px;overflow-wrap:anywhere}
.kv{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);gap:4px 16px;margin:0;padding:0 14px 12px}
.kv dt{color:var(--muted);font-size:13px}
.kv dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.acts{display:flex;gap:8px;padding:0 14px 14px}
.empty{padding:28px;text-align:center;color:var(--muted)}
.chat{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;height:calc(100% - 60px);min-height:420px}
.convs{overflow:auto;display:flex;flex-direction:column;gap:6px}
.conv{display:block;width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r);background:var(--panel);text-align:start;cursor:pointer}
.conv[aria-current=true]{border-color:var(--accent);background:var(--accent-w)}
.conv b{display:flex;gap:6px;align-items:center}
.conv small{display:block;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread{display:flex;flex-direction:column;min-height:0;background:var(--panel);border:1px solid var(--border);border-radius:var(--r)}
.thread header{padding:12px 14px;border-bottom:1px solid var(--border)}
.msgs{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:14px;background:var(--panel2)}
.msg{max-width:78%;padding:8px 12px;border-radius:14px;background:var(--panel);border:1px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}
.msg.op{align-self:flex-end;background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.msg.op{color:#0d1117}}
.msg small{display:block;margin-top:2px;font-size:11px;opacity:.75}
.reply{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:12px;border-top:1px solid var(--border)}
.reply .form{gap:8px}
.reply textarea{min-height:64px}
.content{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px;align-items:start}
.items{display:flex;flex-direction:column;gap:6px}
.item{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
.item[aria-current=true]{border-color:var(--accent);background:var(--accent-w)}
.item .lab{flex:1;min-width:0;padding:4px;border:0;background:none;text-align:start;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib{width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:6px;background:none;cursor:pointer;color:var(--muted)}
.ib:hover{border-color:var(--border);color:var(--text)}
.ib:disabled{opacity:.3;cursor:default}
.form{display:flex;flex-direction:column;gap:14px}
.fld{display:flex;flex-direction:column;gap:5px}
.fld>label,.fld>.lbl{font-weight:600;font-size:13px}
.fld .hint{font-size:12px;color:var(--muted)}
.langs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.langs button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-w);color:var(--accent);font-weight:600}
.rich{min-height:90px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);overflow-wrap:anywhere}
.rich p{margin:0 0 .6em}
.rtb{display:flex;gap:4px}
.att{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.att img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);background:var(--panel2)}
.check{display:flex;align-items:center;gap:8px}
.bar{position:sticky;bottom:-20px;display:flex;gap:10px;align-items:center;margin:4px -20px -20px;padding:12px 20px;background:var(--panel);border-top:1px solid var(--border)}
.dirty{color:var(--danger);font-size:13px}
.toast{position:fixed;inset-inline-end:16px;bottom:16px;z-index:9;max-width:min(420px,calc(100vw - 32px));padding:10px 16px;border-radius:10px;background:var(--text);color:var(--bg);box-shadow:0 10px 30px rgba(0,0,0,.25)}
.toast.err{background:var(--danger);color:#fff}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
table.items-t{width:100%;border-collapse:collapse;margin:0 0 8px}
table.items-t td,table.items-t th{padding:4px 8px;border-bottom:1px solid var(--border);text-align:start;font-size:14px}
.row-f{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.row-f .in{width:auto;flex:1 1 180px}.tw{overflow:auto;padding:0}.tw td,.tw th{padding:8px 10px;text-align:start;vertical-align:middle;border-bottom:1px solid var(--border)}tr.off{opacity:.55}.pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:8px 0 0}
@media (max-width:820px){.app{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.nav{display:flex;gap:4px;overflow-x:auto;border-right:0;border-bottom:1px solid var(--border);padding:6px}.nav h2{display:none}.nav a{flex:none}.chat,.content{grid-template-columns:1fr;height:auto}.convs{max-height:240px}.thread{min-height:420px}}
`;

/* eslint-disable no-restricted-globals */
function adminApp() {
  'use strict';
  var TOKEN = 'lp-admin-token';
  var OPNAME = 'lp-admin-operator';
  // The token lives in sessionStorage: survives reloads of this tab, gone when the tab closes, never sent automatically
  // (unlike a cookie), so other sites cannot ride on it (no CSRF through the token).
  var token = '';
  try { token = sessionStorage.getItem(TOKEN) || ''; } catch (e) { token = ''; }
  var INFO = null;
  var rev = 0;
  var dirty = false;
  var root = document.getElementById('app');
  var KIND = { inbox: 'Form submissions', orders: 'Orders', carts: 'Synced carts', chat: 'Chat', content: 'Content' };

  // Minimal hyperscript: 'text' sets textContent (safe), 'on*' functions become listeners, everything else is an
  // attribute. Strings among children become text nodes, never HTML.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        var v = attrs[k];
        if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function toast(msg, err) {
    var t = h('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 7000 : 3500);
  }
  function fmtDate(t) {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t)); } catch (e) { return new Date(t).toISOString(); }
  }
  // Single choke point for the admin API: adds the bearer token, maps 401 to sign-out, and turns error JSON into thrown
  // Errors so callers have one failure path. raw = binary upload with the file name percent-encoded into a header
  // (headers must be ASCII).
  function api(method, path, body, raw) {
    var o = { method: method, headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' };
    if (body !== undefined) {
      if (raw) { o.body = body; o.headers['Content-Type'] = raw.type || 'application/octet-stream'; o.headers['X-File-Name'] = encodeURIComponent(raw.name || 'file'); }
      else { o.body = JSON.stringify(body); o.headers['Content-Type'] = 'application/json'; }
    }
    return fetch('/api/_admin/' + path, o).then(function (r) {
      if (r.status === 401) { logout(); throw new Error('Signed out'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
        return j;
      });
    });
  }
  // fetch + blob instead of a plain link: a link could not carry the Authorization header. The server's
  // Content-Disposition name is preferred.
  function download(path, fallback) {
    return fetch('/api/_admin/' + path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var cd = r.headers.get('Content-Disposition') || '';
      var m = /filename="([^"]+)"/.exec(cd);
      return r.blob().then(function (b) {
        var u = URL.createObjectURL(b);
        var a = h('a', { href: u, download: m ? m[1] : fallback });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      });
    }).catch(function (e) { toast(e.message, true); });
  }
  function logout() {
    token = '';
    try { sessionStorage.removeItem(TOKEN); } catch (e) { /* ignore */ }
    login();
  }

  /* ---------- sign in ---------- */
  // The token is accepted only after a successful /info call, so a typo is never stored.
  function login(msg) {
    root.textContent = '';
    var inp = h('input', { class: 'in mono', type: 'password', id: 'tok', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'err', role: 'alert', text: msg || '' });
    var f = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      token = inp.value.trim();
      api('GET', 'info').then(function (j) {
        try { sessionStorage.setItem(TOKEN, token); } catch (x) { /* ignore */ }
        INFO = j;
        rev = j.rev;
        shell();
      }).catch(function () { token = ''; err.textContent = 'The token was not accepted.'; inp.focus(); });
    } },
    h('h1', { text: 'Site admin' }),
    h('p', { class: 'muted', text: 'Enter the admin token printed by the server on its first start (or set with ADMIN_TOKEN; kept in data/.admin-token).' }),
    h('div', { class: 'fld' }, h('label', { for: 'tok', text: 'Admin token' }), inp), err,
    h('button', { class: 'btn btn-p', type: 'submit', text: 'Sign in' }));
    root.appendChild(h('div', { class: 'login' }, f));
    inp.focus();
  }

  /* ---------- shell ---------- */
  var nav;
  var main;
  function shell() {
    root.textContent = '';
    nav = h('nav', { class: 'nav', 'aria-label': 'Sections' });
    main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
    root.appendChild(h('div', { class: 'app' },
      h('header', { class: 'top' }, h('h1', { text: INFO.title || INFO.name || 'Site' }),
        h('a', { class: 'btn btn-s', href: '/', target: '_blank', rel: 'noopener', text: 'Open site' }),
        h('button', { class: 'btn btn-s', type: 'button', onclick: logout, text: 'Sign out' })),
      nav, main));
    drawNav();
    route();
    events();
  }
  // Navigation is derived from /info (collections the server's plan provides), so the console never shows sections the
  // site does not have.
  function drawNav() {
    nav.textContent = '';
    var cur = location.hash || '#site';
    var link = function (href, label, extra) {
      return h('a', { href: href, 'aria-current': cur === href || cur.indexOf(href + '/') === 0 ? 'page' : null }, h('span', { text: label }), extra || null);
    };
    var cols = INFO.collections || [];
    var priv = cols.filter(function (c) { return c.kind !== 'content' && c.kind !== 'chat'; });
    var chat = cols.filter(function (c) { return c.kind === 'chat'; })[0];
    var pub = cols.filter(function (c) { return c.kind === 'content'; });
    if (priv.length || chat) nav.appendChild(h('h2', { text: 'Inbox' }));
    priv.forEach(function (c) { nav.appendChild(link('#c/' + c.name, (KIND[c.kind] || 'Records') + ' · ' + c.name, h('span', { class: 'n', text: String(c.count) }))); });
    if (chat) nav.appendChild(link('#chat', 'Chat', chat.unread ? h('span', { class: 'u', text: String(chat.unread), 'aria-label': chat.unread + ' unread' }) : h('span', { class: 'n', text: String(chat.count) })));
    if (pub.length) nav.appendChild(h('h2', { text: 'Content' }));
    pub.forEach(function (c) { nav.appendChild(link('#content/' + c.name, c.typeLabel + ' · ' + c.name, h('span', { class: 'n', text: String(c.count) }))); });
    var acc = INFO.accounts || null;
    if (acc) {
      nav.appendChild(h('h2', { text: 'Accounts' }));
      nav.appendChild(link('#users', 'People', h('span', { class: 'n', text: String(acc.users) })));
      nav.appendChild(link('#outbox', 'Outbox', acc.outbox ? h('span', { class: 'u', text: String(acc.outbox), 'aria-label': acc.outbox + ' not sent' }) : null));
    }
    nav.appendChild(h('h2', { text: 'Site' }));
    nav.appendChild(link('#site', 'Publishing'));
    if (INFO.studio) nav.appendChild(h('a', { href: '/_studio/', target: '_blank', rel: 'noopener' }, h('span', { text: 'Constructor ↗' })));
  }
  /* ---------- accounts ---------- */
  function users() {
    api('GET', 'users').then(function (j) {
      var roles = (j.roles || []).map(function (r) { return r.id; });
      main.appendChild(h('div', { class: 'head' }, h('h2', { text: 'People' }), h('span', { class: 'muted', text: j.users.length + ' · sign-up ' + j.signup })));
      var em = h('input', { class: 'in', type: 'email', placeholder: 'name@example.org', required: true, 'aria-label': 'E-mail' });
      var rs = h('select', { class: 'in', 'aria-label': 'Role' }, roles.map(function (r) { return h('option', { value: r, text: r }); }));
      main.appendChild(h('form', { class: 'card row-f', onsubmit: function (e) {
        e.preventDefault();
        api('POST', 'users/invite', { email: em.value.trim(), role: rs.value }).then(function (x) {
          toast(x.sent ? 'Invitation sent' : 'Invitation link is in the Outbox (no SMTP server)');
          main.textContent = ''; users(); refreshInfo();
        }, function (er) { toast(er.message, true); });
      } }, h('strong', { text: 'Invite' }), em, rs, h('button', { class: 'btn btn-p', type: 'submit', text: 'Send a sign-in link' })));
      var tb = h('tbody', {});
      j.users.forEach(function (u) {
        var sel = h('select', { class: 'in', 'aria-label': 'Role of ' + u.email, onchange: function () {
          api('PATCH', 'users/' + encodeURIComponent(u.id), { role: sel.value }).then(function () { toast('Saved'); }, function (er) { toast(er.message, true); });
        } }, roles.map(function (r) { return h('option', { value: r, text: r, selected: r === u.role }); }));
        var blk = h('button', { class: 'btn btn-s', type: 'button', text: u.blocked ? 'Unblock' : 'Block', onclick: function () {
          api('PATCH', 'users/' + encodeURIComponent(u.id), { blocked: !u.blocked }).then(function () { main.textContent = ''; users(); }, function (er) { toast(er.message, true); });
        } });
        var del = h('button', { class: 'btn btn-s btn-d', type: 'button', text: 'Delete', onclick: function () {
          if (!confirm('Delete the account ' + u.email + '?')) return;
          api('DELETE', 'users/' + encodeURIComponent(u.id)).then(function () { main.textContent = ''; users(); refreshInfo(); }, function (er) { toast(er.message, true); });
        } });
        tb.appendChild(h('tr', { class: u.blocked ? 'off' : '' }, h('td', {}, h('strong', { text: u.name || '—' }), h('br'), h('span', { class: 'mono', text: u.email })),
          h('td', {}, sel), h('td', { class: 'muted', text: (u.password ? 'password' : 'link only') + (u.verified ? ' · verified' : '') }),
          h('td', { class: 'muted', text: u.seen ? fmtDate(u.seen) : 'never' }), h('td', {}, blk, ' ', del)));
      });
      main.appendChild(h('div', { class: 'card tw' }, h('table', { class: 'items-t' }, h('thead', {}, h('tr', {}, ['Person', 'Role', 'Sign-in', 'Last seen', ''].map(function (x) { return h('th', { text: x }); }))), tb)));
    }, function (e) { main.appendChild(h('p', { class: 'err', text: e.message })); });
  }
  function outboxView() {
    api('GET', 'outbox').then(function (j) {
      main.appendChild(h('div', { class: 'head' }, h('h2', { text: 'Outbox' }), h('span', { class: 'muted', text: j.smtp ? 'SMTP server configured' : 'No SMTP server: set SMTP_URL and MAIL_FROM to send mail; until then pass these links on yourself.' })));
      if (!j.outbox.length) main.appendChild(h('p', { class: 'muted', text: 'No messages yet.' }));
      j.outbox.forEach(function (m) {
        main.appendChild(h('details', { class: 'card rec' }, h('summary', {}, h('strong', { text: m.subject }), ' → ', m.to, ' · ', h('span', { class: m.sent ? 'muted' : 'err', text: m.sent ? 'sent' : 'not sent' }), ' · ', h('span', { class: 'muted', text: fmtDate(m.at) })),
          h('pre', { class: 'mono pre', text: m.text }), m.error ? h('p', { class: 'err', text: m.error }) : null));
      });
    }, function (e) { main.appendChild(h('p', { class: 'err', text: e.message })); });
  }
  function refreshInfo() {
    return api('GET', 'info').then(function (j) { INFO = j; drawNav(); });
  }
  // Hash routing: reload-safe, shareable within the console, no server routes needed.
  // KNOWN DEFECT: when the user declines to discard changes, the hash has already changed, so the address shows the new
  // section while the old form stays on screen. Fix: remember the previous hash and restore it (history.replaceState).
  window.addEventListener('hashchange', function () {
    if (dirty && !confirm('Discard the unsaved changes?')) return;
    dirty = false;
    drawNav();
    route();
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  function route() {
    var hs = location.hash.replace(/^#/, '').split('/');
    main.textContent = '';
    if (hs[0] === 'c' && hs[1]) inbox(decodeURIComponent(hs[1]));
    else if (hs[0] === 'chat') chatView(hs[1] ? decodeURIComponent(hs[1]) : '');
    else if (hs[0] === 'content' && hs[1]) content(decodeURIComponent(hs[1]));
    else if (hs[0] === 'users') users();
    else if (hs[0] === 'outbox') outboxView();
    else site();
  }
  // Admin events (long-poll): new submissions, messages, saved content → refresh the counts and the open inbox / chat.
  var evBusy = false;
  // One long-poll at a time (evBusy). On change: refresh counts, and redraw an open inbox / chat with `keep` so expanded
  // records and a half-typed reply survive. Back-off to 5 s on errors so a stopped server is not hammered.
  function events() {
    if (evBusy || !token) return;
    evBusy = true;
    fetch('/api/_admin/events?rev=' + rev + '&wait=25', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        evBusy = false;
        if (j && j.rev > rev) {
          rev = j.rev;
          refreshInfo();
          var hs = location.hash.split('/');
          if (hs[0] === '#c' && main.dataset.view === 'inbox') inbox(decodeURIComponent(hs[1] || ''), true);
          if (hs[0] === '#chat' && main.dataset.view === 'chat') chatView(hs[1] ? decodeURIComponent(hs[1]) : '', true);
        }
        setTimeout(events, j ? 200 : 5000);
      }, function () { evBusy = false; setTimeout(events, 5000); });
  }

  /* ---------- inbox ---------- */
  // Flattens a record for display as key / value rows; arrays stay JSON (an order's items get their own table).
  function flat(v, pre, out) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { Object.keys(v).forEach(function (k) { flat(v[k], pre ? pre + '.' + k : k, out); }); return out; }
    out.push([pre || 'value', v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)]);
    return out;
  }
  // One-line preview: prefer the form fields or the customer block (the conventional payload shapes of form submissions
  // and orders), at most four short values, plus an items / total hint for orders.
  function summary(d) {
    if (!d || typeof d !== 'object') return String(d);
    var src = d.fields && typeof d.fields === 'object' ? d.fields : d.customer && typeof d.customer === 'object' ? d.customer : d;
    var parts = [];
    Object.keys(src).forEach(function (k) { var v = src[k]; if (parts.length < 4 && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) parts.push(String(v).trim().slice(0, 80)); });
    if (Array.isArray(d.items)) parts.push(d.items.length + ' items' + (d.total != null ? ' · ' + d.total + (d.currency ? ' ' + d.currency : '') : ''));
    return parts.join(' · ') || '—';
  }
  function inbox(name, keep) {
    main.dataset.view = 'inbox';
    var c = (INFO.collections || []).filter(function (x) { return x.name === name; })[0];
    var open = {};
    if (keep) Array.prototype.forEach.call(main.querySelectorAll('details[open]'), function (d) { open[d.dataset.id] = true; });
    api('GET', 'c/' + encodeURIComponent(name)).then(function (j) {
      main.textContent = '';
      main.appendChild(h('div', { class: 'head' }, h('h2', { text: (KIND[j.kind] || 'Records') + ' · ' + name }),
        h('button', { class: 'btn', type: 'button', onclick: function () { download('c/' + encodeURIComponent(name) + '.csv', name + '.csv'); }, text: 'Export CSV' }),
        h('button', { class: 'btn', type: 'button', onclick: function () { download('c/' + encodeURIComponent(name) + '.json', name + '.json'); }, text: 'Export JSON' })));
      if (!j.records.length) { main.appendChild(h('p', { class: 'empty', text: 'Nothing here yet.' })); return; }
      var list = h('div', { class: 'list' });
      j.records.forEach(function (r) {
        var d = r.data;
        var rows = flat(d, '', []);
        var det = h('details', { class: 'rec', 'data-id': r.id, open: open[r.id] || null },
          h('summary', {}, h('time', { datetime: new Date(r.at).toISOString(), text: fmtDate(r.at) }), h('span', { class: 'sum', text: summary(d) })),
          Array.isArray(d && d.items) ? itemsTable(d) : null,
          h('dl', { class: 'kv' }, rows.map(function (kv) { return [h('dt', { text: kv[0] }), h('dd', { text: kv[1] })]; }).reduce(function (a, b) { return a.concat(b); }, [])),
          h('div', { class: 'acts' }, h('button', { class: 'btn btn-s btn-d', type: 'button', text: 'Delete', onclick: function () {
            if (!confirm('Delete this record?')) return;
            api('DELETE', 'c/' + encodeURIComponent(name) + '/' + encodeURIComponent(r.id)).then(function () { det.remove(); toast('Deleted'); refreshInfo(); }, function (e) { toast(e.message, true); });
          } })));
        list.appendChild(det);
      });
      main.appendChild(list);
      if (c) c.count = j.records.length;
    }, function (e) { main.appendChild(h('p', { class: 'err', text: e.message })); });
  }
  function itemsTable(d) {
    return h('table', { class: 'items-t' }, h('tbody', {}, d.items.map(function (it) {
      return h('tr', {}, h('td', { text: String(it.qty != null ? it.qty : it.q != null ? it.q : '') + ' ×' }), h('td', { text: String(it.name || it.sku || it.s || '') }),
        h('td', { class: 'mono', text: String(it.sku || '') }), h('td', { text: it.price != null ? String(it.price) : '' }));
    })));
  }

  /* ---------- chat ---------- */
  // KNOWN DEFECT: localStorage.getItem(OPNAME) below is not wrapped in try / catch (the setItem call is), so a browser
  // with blocked storage throws here and the conversation never renders. Fix: read it through a guarded helper.
  function chatView(conv, keep) {
    main.dataset.view = 'chat';
    api('GET', 'chat').then(function (j) {
      var keepText = keep && main.querySelector('.reply textarea') ? main.querySelector('.reply textarea').value : '';
      main.textContent = '';
      main.appendChild(h('div', { class: 'head' }, h('h2', { text: 'Chat' })));
      if (!j.convs.length) { main.appendChild(h('p', { class: 'empty', text: 'No conversations yet.' })); return; }
      var list = h('div', { class: 'convs', role: 'list' });
      j.convs.forEach(function (c) {
        var who = (c.visitor && (c.visitor.name || c.visitor.contact)) || 'Visitor';
        list.appendChild(h('button', { class: 'conv', type: 'button', role: 'listitem', 'aria-current': c.id === conv ? 'true' : null,
          onclick: function () { location.hash = '#chat/' + encodeURIComponent(c.id); } },
          h('b', {}, who, c.unread ? h('span', { class: 'u', text: String(c.unread) }) : null),
          h('small', { text: c.last ? (c.last.from === 'operator' ? '↩ ' : '') + c.last.text : '' }),
          h('small', { text: fmtDate(c.up) })));
      });
      var thread = h('section', { class: 'thread', 'aria-label': 'Conversation' });
      main.appendChild(h('div', { class: 'chat' }, list, thread));
      if (!conv) { thread.appendChild(h('p', { class: 'empty', text: 'Choose a conversation.' })); return; }
      api('GET', 'chat/' + encodeURIComponent(conv)).then(function (c) {
        var v = c.visitor || {};
        thread.appendChild(h('header', {}, h('strong', { text: v.name || 'Visitor' }), v.contact ? h('span', { class: 'muted', text: ' · ' + v.contact }) : null,
          h('div', { class: 'muted', text: [c.lang, c.page].filter(Boolean).join(' · ') })));
        var msgs = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
        c.msgs.forEach(function (m) {
          msgs.appendChild(h('div', { class: 'msg' + (m.from === 'operator' ? ' op' : '') }, m.text, h('small', { text: (m.from === 'operator' ? (m.name || 'You') + ' · ' : '') + fmtDate(m.at) })));
        });
        var name = h('input', { class: 'in', placeholder: 'Your name (shown to the visitor)', 'aria-label': 'Operator name', value: localStorage.getItem(OPNAME) || '' });
        var ta = h('textarea', { class: 'in', placeholder: 'Reply…', 'aria-label': 'Reply', value: keepText });
        var sendIt = function () {
          var text = ta.value.trim();
          if (!text) return;
          try { localStorage.setItem(OPNAME, name.value.trim()); } catch (e) { /* ignore */ }
          api('POST', 'chat/' + encodeURIComponent(conv), { text: text, name: name.value.trim() }).then(function () { ta.value = ''; chatView(conv); }, function (e) { toast(e.message, true); });
        };
        ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendIt(); } });
        thread.appendChild(msgs);
        thread.appendChild(h('div', { class: 'reply' }, h('div', { class: 'form' }, name, ta),
          h('div', { class: 'form' }, h('button', { class: 'btn btn-p', type: 'button', onclick: sendIt, text: 'Send' }),
            h('button', { class: 'btn btn-s btn-d', type: 'button', text: 'Delete', onclick: function () {
              if (!confirm('Delete this conversation?')) return;
              api('DELETE', 'chat/' + encodeURIComponent(conv)).then(function () { location.hash = '#chat'; refreshInfo(); }, function (e) { toast(e.message, true); });
            } }))));
        msgs.scrollTop = msgs.scrollHeight;
        if (!keep) ta.focus();
        refreshInfo();
      }, function (e) { thread.appendChild(h('p', { class: 'err', text: e.message })); });
    }, function (e) { main.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  /* ---------- content ---------- */
  // Edits a local copy of the collection (S.items) and publishes everything with one PUT; `dirty` guards navigation and
  // unload. Saving replaces S.items with the server's sanitized result, so the form shows what is actually published.
  function content(name) {
    main.dataset.view = 'content';
    var S = null;
    var sel = 0;
    var lang = '';
    var urls = {};
    var listBox = h('div', { class: 'items', role: 'list' });
    var formBox = h('div', { class: 'card form' });
    var dirtyNote = h('span', { class: 'dirty', hidden: true, text: 'Unsaved changes' });
    var saveBtn = h('button', { class: 'btn btn-p', type: 'button', text: 'Save and publish', onclick: save });
    function mark() { dirty = true; dirtyNote.hidden = false; }
    function txt(v) {
      if (v && typeof v === 'object') return String(v[INFO.defaultLang] || v[Object.keys(v)[0]] || '');
      return v == null ? '' : String(v);
    }
    function labelOf(it, i) {
      var k = S.itemLabel;
      var s = k ? txt(it[k]) : '';
      if (!s) S.fields.some(function (f) { if (f.type === 'i18n' || f.type === 'text') { s = txt(it[f.key]); } return !!s; });
      return (s || 'Item ' + (i + 1)).replace(/<[^>]*>/g, '').slice(0, 80);
    }
    function drawList() {
      listBox.textContent = '';
      S.items.forEach(function (it, i) {
        var mv = function (d) { var j = i + d; if (j < 0 || j >= S.items.length) return; S.items.splice(j, 0, S.items.splice(i, 1)[0]); sel = j; mark(); drawList(); drawForm(); };
        listBox.appendChild(h('div', { class: 'item', role: 'listitem', 'aria-current': i === sel ? 'true' : null },
          h('button', { class: 'lab', type: 'button', text: labelOf(it, i), onclick: function () { sel = i; drawList(); drawForm(); } }),
          h('button', { class: 'ib', type: 'button', title: 'Up', 'aria-label': 'Move up', text: '↑', disabled: i === 0, onclick: function () { mv(-1); } }),
          h('button', { class: 'ib', type: 'button', title: 'Down', 'aria-label': 'Move down', text: '↓', disabled: i === S.items.length - 1, onclick: function () { mv(1); } }),
          h('button', { class: 'ib', type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate', text: '⧉', onclick: function () {
            var c = JSON.parse(JSON.stringify(it));
            delete c.id;
            if (typeof c.sku === 'string' && c.sku) c.sku = c.sku + '-copy';
            S.items.splice(i + 1, 0, c); sel = i + 1; mark(); drawList(); drawForm();
          } }),
          h('button', { class: 'ib', type: 'button', title: 'Delete', 'aria-label': 'Delete', text: '✕', onclick: function () {
            if (!confirm('Delete this item?')) return;
            S.items.splice(i, 1); sel = Math.max(0, Math.min(sel, S.items.length - 1)); mark(); drawList(); drawForm();
          } })));
      });
      listBox.appendChild(h('button', { class: 'btn', type: 'button', text: '+ Add item', onclick: function () {
        var it = {};
        S.fields.forEach(function (f) {
          if (f.type === 'i18n' || f.type === 'rich') it[f.key] = {};
          else if (f.type === 'checkbox') it[f.key] = false;
          else if (f.type === 'select' && f.options && f.options.length) it[f.key] = f.options[0].v;
          else if (f.type === 'number' || f.type === 'range') it[f.key] = f.nullable ? null : f.min != null ? f.min : 0;
          else if (f.type === 'att') it[f.key] = null;
          else if (f.type !== 'json') it[f.key] = '';
        });
        S.items.push(it); sel = S.items.length - 1; mark(); drawList(); drawForm();
      } }));
    }
    function shown(f, it) {
      if (!f.when) return true;
      return Object.keys(f.when).every(function (k) { var w = f.when[k]; return Array.isArray(w) ? w.indexOf(it[k]) >= 0 : it[k] === w; });
    }
    // Previews go through the authenticated admin endpoint and object URLs (img src cannot send the Authorization header).
    function fileURL(id) {
      if (urls[id]) return Promise.resolve(urls[id]);
      return fetch('/api/_admin/file/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token } }).then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) { if (!b) return ''; urls[id] = URL.createObjectURL(b); return urls[id]; });
    }
    var fseq = 0;
    function control(f, it) {
      var id = 'f' + (++fseq);
      var v = it[f.key];
      var set = function (x, redraw) { it[f.key] = x; mark(); if (redraw) drawForm(); if (f.key === S.itemLabel || redraw) drawList(); };
      var deps = S.fields.some(function (g) { return g.when && Object.prototype.hasOwnProperty.call(g.when, f.key); });
      var lbl = h('label', { for: id, text: f.label + (f.type === 'i18n' || f.type === 'rich' ? ' (' + lang.toUpperCase() + ')' : '') });
      var el;
      if (f.type === 'i18n') {
        var o = v && typeof v === 'object' ? v : (it[f.key] = {});
        var tag = f.multiline ? 'textarea' : 'input';
        el = h(tag, { id: id, class: 'in', dir: 'auto', lang: lang, value: o[lang] || '', placeholder: lang !== INFO.defaultLang ? o[INFO.defaultLang] || '' : '' });
        el.addEventListener('input', function () { o[lang] = el.value; mark(); if (f.key === S.itemLabel) drawList(); });
      } else if (f.type === 'rich') {
        var r = v && typeof v === 'object' ? v : (it[f.key] = {});
        el = h('div', { id: id, class: 'rich', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', lang: lang });
        el.innerHTML = r[lang] || '';
        el.addEventListener('input', function () { r[lang] = el.innerHTML; mark(); });
        // Paste as plain text: pasted HTML from other pages would bring styles and markup the sanitizer then strips anyway;
        // execCommand is deprecated but remains the only way to insert into contenteditable with native undo.
        el.addEventListener('paste', function (e) {
          e.preventDefault();
          var t = (e.clipboardData || window.clipboardData).getData('text/plain');
          document.execCommand('insertText', false, t);
        });
        var cmd = function (c, arg) { return function () { el.focus(); document.execCommand(c, false, arg); r[lang] = el.innerHTML; mark(); }; };
        var tb = h('div', { class: 'rtb' },
          h('button', { class: 'btn btn-s', type: 'button', text: 'B', title: 'Bold', onclick: cmd('bold') }),
          h('button', { class: 'btn btn-s', type: 'button', text: 'I', title: 'Italic', onclick: cmd('italic') }),
          h('button', { class: 'btn btn-s', type: 'button', text: '•', title: 'List', onclick: cmd('insertUnorderedList') }),
          h('button', { class: 'btn btn-s', type: 'button', text: 'Link', onclick: function () {
            var u = prompt('Link address (https://…)');
            // Scheme allow-list: no javascript: or data: links (the server sanitizer enforces the same).
            if (u && /^(https?:|mailto:|tel:|#)/i.test(u)) cmd('createLink', u)();
          } }));
        return h('div', { class: 'fld' }, h('span', { class: 'lbl', id: id + 'l', text: lbl.textContent }), tb, el);
      } else if (f.type === 'select') {
        el = h('select', { id: id, class: 'in' }, (f.options || []).map(function (op) { return h('option', { value: String(op.v), text: op.l, selected: String(op.v) === String(v) || null }); }));
        el.addEventListener('change', function () { var op = (f.options || []).filter(function (x) { return String(x.v) === el.value; })[0]; set(op ? op.v : el.value, deps); });
      } else if (f.type === 'checkbox') {
        el = h('input', { id: id, type: 'checkbox', checked: !!v });
        el.addEventListener('change', function () { set(el.checked, deps); });
        return h('div', { class: 'fld check' }, el, h('label', { for: id, text: f.label }));
      } else if (f.type === 'number' || f.type === 'range') {
        el = h('input', { id: id, class: 'in', type: 'number', min: f.min, max: f.max, step: f.step || 'any', value: v == null ? '' : String(v) });
        el.addEventListener('input', function () { var s = el.value.trim(); it[f.key] = s === '' ? (f.nullable ? null : 0) : Number(s); mark(); });
      } else if (f.type === 'textarea') {
        el = h('textarea', { id: id, class: 'in', rows: f.rows || 3, value: v || '' });
        el.addEventListener('input', function () { set(el.value); });
      } else if (f.type === 'day' || f.type === 'time') {
        el = h('input', { id: id, class: 'in', type: f.type === 'day' ? 'date' : 'time', value: v || '' });
        el.addEventListener('input', function () { set(el.value); });
      } else if (f.type === 'icon') {
        el = h('select', { id: id, class: 'in' }, h('option', { value: '', text: '—' }), (S.icons || []).map(function (n) { return h('option', { value: n, text: n, selected: n === v || null }); }));
        el.addEventListener('change', function () { set(el.value); });
      } else if (f.type === 'att') {
        var img = h('img', { alt: '', hidden: true });
        var info = h('span', { class: 'muted' });
        var paint = function () {
          var a = it[f.key] && S.atts[it[f.key]];
          info.textContent = a ? a.name : 'No file';
          img.hidden = true;
          if (a && /^image\//.test(a.mime)) fileURL(it[f.key]).then(function (u) { if (u) { img.src = u; img.hidden = false; } });
        };
        var pick = h('input', { type: 'file', id: id, accept: f.accept || '', class: 'sr' });
        pick.addEventListener('change', function () {
          var file = pick.files && pick.files[0];
          if (!file) return;
          api('POST', 'files', file, { type: file.type || 'application/octet-stream', name: file.name }).then(function (j) {
            S.atts[j.id] = { name: j.name, mime: j.mime, size: j.size };
            set(j.id);
            paint();
          }, function (e) { toast(e.message, true); });
        });
        paint();
        return h('div', { class: 'fld' }, h('span', { class: 'lbl', text: f.label }), h('div', { class: 'att' }, img, info,
          h('label', { class: 'btn btn-s', for: id, text: 'Upload…' }), pick,
          h('button', { class: 'btn btn-s', type: 'button', text: 'Remove', onclick: function () { set(null); paint(); } })));
      } else if (f.type === 'json') {
        // A structured value this console has no form for: edited as JSON, applied only when it parses.
        el = h('textarea', { id: id, class: 'in mono', rows: 6, spellcheck: 'false', value: JSON.stringify(v == null ? null : v, null, 1) });
        el.addEventListener('input', function () {
          try { it[f.key] = JSON.parse(el.value); el.removeAttribute('aria-invalid'); mark(); } catch (e) { el.setAttribute('aria-invalid', 'true'); }
        });
      } else {
        el = h('input', { id: id, class: 'in', type: 'text', dir: 'auto', value: v == null ? '' : String(v) });
        el.addEventListener('input', function () { set(el.value); });
      }
      return h('div', { class: 'fld' }, lbl, el, f.hint ? h('span', { class: 'hint', text: f.hint }) : null);
    }
    function drawForm() {
      formBox.textContent = '';
      var it = S.items[sel];
      if (!it) { formBox.appendChild(h('p', { class: 'empty', text: 'No items. Add one.' })); return; }
      if (INFO.langs.length > 1) {
        formBox.appendChild(h('div', { class: 'langs', role: 'group', 'aria-label': 'Language of the texts' }, h('span', { class: 'muted', text: 'Language:' }),
          INFO.langs.map(function (l) { return h('button', { class: 'btn btn-s', type: 'button', 'aria-pressed': l === lang ? 'true' : 'false', text: l.toUpperCase(), onclick: function () { lang = l; drawForm(); } }); })));
      }
      S.fields.forEach(function (f) { if (shown(f, it)) formBox.appendChild(control(f, it)); });
    }
    function save() {
      saveBtn.disabled = true;
      api('PUT', 'content/' + encodeURIComponent(name), { items: S.items }).then(function (j) {
        S.items = j.items;
        dirty = false;
        dirtyNote.hidden = true;
        saveBtn.disabled = false;
        sel = Math.min(sel, S.items.length - 1);
        drawList();
        drawForm();
        toast('Saved. The site was regenerated.');
        refreshInfo();
      }, function (e) { saveBtn.disabled = false; toast(e.message, true); });
    }
    api('GET', 'content/' + encodeURIComponent(name)).then(function (j) {
      S = j;
      lang = INFO.defaultLang;
      main.textContent = '';
      main.appendChild(h('div', { class: 'head' }, h('h2', { text: j.typeLabel + ' · ' + name }),
        h('span', { class: 'muted', text: 'Public content: shown on the page and in data/' + name + '.json' })));
      main.appendChild(h('div', { class: 'content' }, listBox, formBox));
      main.appendChild(h('div', { class: 'bar' }, saveBtn, dirtyNote));
      drawList();
      drawForm();
    }, function (e) { main.appendChild(h('p', { class: 'err', text: e.message })); });
  }

  /* ---------- site ---------- */
  function site() {
    main.dataset.view = 'site';
    var busy = function (b, p) { b.disabled = true; p.then(function () { b.disabled = false; }, function () { b.disabled = false; }); return p; };
    var rb = h('button', { class: 'btn', type: 'button', text: 'Rebuild the site', onclick: function () {
      busy(rb, api('POST', 'rebuild').then(function (j) { toast('Rebuilt: ' + j.files + ' files'); }, function (e) { toast(e.message, true); }));
    } });
    var sn = h('button', { class: 'btn btn-p', type: 'button', text: 'Download static snapshot (.zip)', onclick: function () { busy(sn, download('snapshot.zip', 'site-static.zip')); } });
    var pj = h('button', { class: 'btn', type: 'button', text: 'Download project (.landing.json)', onclick: function () { busy(pj, download('site.json', 'site.landing.json')); } });
    main.appendChild(h('div', { class: 'head' }, h('h2', { text: 'Publishing' })));
    main.appendChild(h('div', { class: 'grid2' },
      h('section', { class: 'card' }, h('h3', { text: 'Static hosting' }),
        h('p', { class: 'muted', text: 'A snapshot is the site as plain files for Codeberg Pages, GitHub Pages or any web host. Without this server the page shows the data of the snapshot, forms use their fallback channel and the chat becomes “leave a message”.' }), sn),
      h('section', { class: 'card' }, h('h3', { text: 'Design changes' }),
        h('p', { class: 'muted', text: 'Open the project file in the Landing Builder to change the design or the texts, then export a backend archive again. Collected data stays in data/.' }), pj),
      h('section', { class: 'card' }, h('h3', { text: 'This server' }),
        h('dl', { class: 'kv' }, h('dt', { text: 'Mode' }), h('dd', { text: INFO.target === 'hybrid' ? 'server with a static fallback' : 'server' }),
          h('dt', { text: 'Languages' }), h('dd', { text: INFO.langs.join(', ') }),
          h('dt', { text: 'Admin token' }), h('dd', { text: INFO.token === 'env' ? 'ADMIN_TOKEN variable' : 'data/.admin-token' })), rb)));
  }

  // A saved token, or the session of an administrator account of the site (the cookie goes with every request).
  api('GET', 'info').then(function (j) { INFO = j; rev = j.rev; shell(); }, function () { login(); });
}

// The nonce must match the CSP header sent by backend-server.js; it is escaped anyway (defence in depth). noindex:
// the console must not appear in search results. The '</script' replacement keeps the serialized function from
// closing its own script element.
function adminHTML({ nonce, name }) {
  const n = escapeAttr(String(nonce || ''));
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow">'
    + `<title>Admin · ${escapeHTML(String(name || 'Site'))}</title><style nonce="${n}">${ADMIN_CSS}</style></head>\n`
    + `<body>\n<div id="app"></div>\n<noscript>The admin console needs JavaScript.</noscript>\n<script nonce="${n}">(${adminApp.toString().replace(/<\/(script)/gi, '<\\/$1')})();</script>\n</body>\n</html>\n`;
}

export {
  ADMIN_CSS,
  adminApp,
  adminHTML
};
