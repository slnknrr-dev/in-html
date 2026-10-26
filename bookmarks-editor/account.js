// bookmarks-editor/account.js - accounts and synchronisation of the hosted modes. The offline artifact gets
// account.offline.js instead (bundle.js variant): the same exports, no network code and no account interface.
//
//   await startAccount({ mode, gate }) -> { dbName, account | null }
//     backend / dev: this page's origin is the server; signed out -> the sign-in, owner set-up or invitation screen
//     (gate(el) shows it) until the user is in; offline with a remembered user -> that user's local copy
//     standalone: the server, user and bearer token the user connected in Settings (localStorage), or none
//   account: { user, role, server, features, meta(url), chip(), settingsSection(), attach({ lib, store, flush }), syncNow() }
//
// Design decisions:
// - One IndexedDB database per signed-in user (`in-html-bookmarks@<name>`), the plain name for the local-only
//   library. Two people sharing a browser never see each other's offline copy, and signing out never has to
//   merge two libraries. Cost: a user who first worked signed out keeps that data in the plain database.
// - Sync is a revision log, not a snapshot: the client sends its dirty records plus `since` (last server revision)
//   and receives every change after it. Idempotent: resending a chunk after a lost response is harmless, so the
//   client marks records clean only after the server answered.
// - Every failure maps to a status shown in the header chip (offline / auth / error); sync never throws into the UI.
import { h, lsGet, lsSet } from '../ui/dom.js';
import { icon, iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, openMenu, promptDialog, toast } from '../ui/overlays.js';
import { copyText } from '../ui/app.js';
import { createRemote } from './remote.js';
import { S, UI, dateText, when } from './common.js';

export const networked = true;
const LOCAL_DB = 'in-html-bookmarks';
const REMOTE_KEY = 'bm-remote';

// Error codes of the service (service.js) with their own text; others show the server's message.
// Whitelist instead of `t('bm.err.' + code)` for any code: an unknown key would print the raw key to the user.
const KNOWN = new Set(['wrong_login', 'rate', 'bad_name', 'bad_password', 'setup_done', 'bad_invite', 'name_taken', 'auth', 'network', 'wrong_password',
  'forbidden', 'meta_disabled', 'blocked_address', 'fetch_failed', 'too_large', 'bad_origin', 'bad_url']);
export const errText = (e) => (e && KNOWN.has(e.code) ? t('bm.err.' + e.code, { s: (e.data && e.data.retry) || 60 }) : t('bm.err.generic', { msg: (e && e.message) || String(e) }));

// --- sign-in screens -------------------------------------------------------------------------------------------------------
// One form, three flows (login / owner setup / invited register): the fields and the API call differ only by kind.
// autocomplete=username/current-password/new-password lets password managers fill and offer to save correctly;
// novalidate: the browser's own bubbles are replaced by the inline .ed-error (role=alert is announced at once).
function authForm(kind, { remote, invite, onIn, server, wantToken = false }) {
  const name = h('input', { type: 'text', class: 'ed-input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, autofocus: true });
  const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: kind === 'login' ? 'current-password' : 'new-password', required: true });
  const pw2 = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password', required: true });
  const err = h('p', { class: 'ed-error bm-auth-err', role: 'alert', hidden: true });
  const btn = h('button', { type: 'submit', class: 'ed-btn ed-primary bm-auth-go' }, t('bm.auth.' + kind + '.go'));
  // Random id ties <label for> to the input: clicking the label focuses it and screen readers read the label.
  const row = (label, input) => { input.id = input.id || 'bm-a-' + Math.random().toString(36).slice(2, 8); return h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: input.id }, label), input); };
  const form = h('form', { class: 'bm-auth-form', novalidate: true },
    h('h2', null, t('bm.auth.' + kind + '.title')),
    h('p', { class: 'ed-hint' }, t('bm.auth.' + kind + '.lead', { server: server || location.host })),
    row(t('bm.auth.name'), name), row(t('bm.auth.password'), pw), kind !== 'login' ? row(t('bm.auth.password2'), pw2) : null,
    kind !== 'login' ? h('p', { class: 'ed-hint' }, t('bm.auth.rules')) : null, err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    // Client-side check only for typos; password rules are enforced by the server (service.js), never trusted here.
    if (kind !== 'login' && pw.value !== pw2.value) { err.textContent = t('bm.auth.mismatch'); err.hidden = false; return; }
    // Disabled during the request: prevents double submit (a second setup call would hit setup_done).
    btn.disabled = true;
    btn.classList.add('bm-busy');
    try {
      const body = { name: name.value.trim(), password: pw.value, ...(wantToken ? { token: true, label: t('bm.auth.tokenLabel') } : {}) };
      const r = kind === 'setup' ? await remote.setup(body) : kind === 'register' ? await remote.register({ ...body, invite }) : await remote.login(body);
      onIn(r);
    } catch (ex) {
      err.textContent = errText(ex);
      err.hidden = false;
    } finally { btn.disabled = false; btn.classList.remove('bm-busy'); }
  });
  return form;
}

function gateScreen(content, note) {
  return h('div', { class: 'bm-gate' }, h('div', { class: 'bm-gate-card' },
    h('div', { class: 'bm-gate-logo', html: icon('bookmark') }), content, note ? h('p', { class: 'ed-hint bm-gate-note' }, note) : null));
}

// --- start ------------------------------------------------------------------------------------------------------------------------
// Modes: standalone / serverless = a file not served by the bookmark server, so the server comes from Settings
// (bearer token). backend / dev = same origin as the server, so the session cookie authenticates.
export async function startAccount({ mode, gate }) {
  if (mode === 'standalone' || mode === 'serverless') {
    const saved = lsGet(REMOTE_KEY, null);
    if (saved && saved.server && saved.token) return { dbName: LOCAL_DB, account: makeAccount({ remote: createRemote({ base: saved.server, token: saved.token }), user: saved.user, role: saved.role, server: saved.server, kind: 'token' }) };
    return { dbName: LOCAL_DB, account: makeAccount({ remote: null, kind: 'none' }) };
  }
  // backend (the page's own origin) and dev (sources served by server.js, backend mounted or not)
  const remote = createRemote({ base: '' });
  // Invitation token travels in the fragment, not the query: fragments are never sent to servers or in Referer.
  const invite = (/[#&]invite=([A-Za-z0-9_-]+)/.exec(location.hash) || [])[1] || '';
  // Loop until signed in: every gate screen resolves a promise and the loop re-asks the server for the session.
  // A loop, not recursion: no stack growth and one exit point for all three outcomes.
  for (;;) {
    let s;
    try { s = await remote.session(); } catch (e) {
      // Dev server without the backend mounted: no /api at all, so run local-only instead of failing.
      if (mode === 'dev' && (e.status === 404 || e.status === 0 || e.status === 405)) return { dbName: LOCAL_DB, account: null };
      const last = lsGet('bm-last-user', null);
      // Network down (status 0) but someone signed in here before: open that user's local copy in offline mode.
      // Only status 0: a 5xx means the server is up but broken, and showing stale data as "offline" would mislead.
      if (e.status === 0 && last) return { dbName: `${LOCAL_DB}@${last.name}`, account: makeAccount({ remote, user: last.name, role: last.role, server: location.origin, kind: 'origin', offline: true }) };
      await new Promise((resolve) => gate(gateScreen(h('div', null, h('h2', null, t('bm.auth.unreachable')), h('p', null, errText(e)),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: resolve }, t('bm.auth.retry'))))));
      continue;
    }
    if (s.user) {
      lsSet('bm-last-user', { name: s.user.name, role: s.user.role });
      // Drop the used invite from the URL so reload or a shared address does not replay it.
      if (invite) history.replaceState(null, '', location.pathname + location.search);
      return { dbName: `${LOCAL_DB}@${s.user.name}`, account: makeAccount({ remote, user: s.user.name, role: s.user.role, server: location.origin, kind: 'origin', features: s.features }) };
    }
    const kind = s.setup ? 'setup' : invite ? 'register' : 'login';
    await new Promise((resolve) => {
      const form = authForm(kind, { remote, invite, onIn: resolve });
      gate(gateScreen(form, kind === 'login' ? t('bm.auth.inviteNote') : null));
    });
  }
}

// --- the account ------------------------------------------------------------------------------------------------------------------
// The account object is a closure over sync state: no class, no `this`, methods can be passed as callbacks.
function makeAccount({ remote, user = '', role = 'user', server = '', kind, features = null, offline = false }) {
  const acc = {
    remote, user, role, server, kind, features: features || { meta: false, public: kind !== 'none' },
    status: kind === 'none' ? 'none' : offline ? 'offline' : 'idle', last: 0, pending: 0, error: '',
  };
  let lib = null, store = null, flush = async () => {}, since = 0, running = false, again = false, timer = 0, chipEl = null;
  const listeners = new Set();
  const setStatus = (st, error = '') => { acc.status = st; acc.error = error; paintChip(); for (const fn of listeners) fn(acc); };

  // Single-flight sync: a call while one is running sets `again` and returns; the running pass reschedules once at
  // the end. Without it, two overlapping passes would send the same dirty records with the same `since`.
  async function run() {
    if (!remote || !lib) return;
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      // flush() writes pending in-memory edits to IndexedDB first, so store.dirty() sees every local change.
      await flush();
      let dirty = await store.dirty();
      let first = true;
      // At least one round even with nothing dirty: it pulls remote changes. Chunks capped at 2000 records / ~2 MB
      // of JSON to stay under the server body limit; the size is measured as the JSON it will be sent as.
      while (first || dirty.length) {
        first = false;
        const chunk = [];
        let size = 0;
        while (dirty.length && chunk.length < 2000 && size < 2e6) { const r = dirty.shift(); size += JSON.stringify(r).length; chunk.push(r); }
        const res = await remote.sync(since, chunk);
        // Clock skew from the server's `now`: record timestamps decide last-writer-wins, so a client clock minutes
        // off would win or lose every conflict. Under 3 s the skew is noise (request latency) and is ignored.
        lib.clock.skew = Math.abs(res.now - Date.now()) > 3000 ? res.now - Date.now() : 0;
        lib.merge(res.changes);
        await flush();
        // Mark clean only after the server accepted the chunk and the merge is persisted: a crash in between
        // resends, which the revision log tolerates (idempotent upsert).
        await store.clean(chunk);
        since = res.rev;
        await store.setMeta('rev', since);
        if (res.rejected && res.rejected.length) console.warn('records refused by the server:', res.rejected);
      }
      acc.pending = (await store.dirty()).length;
      acc.last = Date.now();
      setStatus('ok');
    } catch (e) {
      try { acc.pending = (await store.dirty()).length; } catch { /* ignore */ }
      // 401 = token revoked or session expired: needs a new sign-in, distinct from a transient network error.
      if (e.status === 401) setStatus('auth', errText(e));
      else if (e.status === 0) setStatus('offline', errText(e));
      else setStatus('error', errText(e));
    } finally {
      running = false;
      if (again) { again = false; schedule(400); }
    }
  }
  // Debounce: a burst of edits becomes one sync 1.5 s after the last one.
  function schedule(ms = 1500) { clearTimeout(timer); timer = setTimeout(run, ms); }

  // Triggers: local edits (debounced), every 60 s while visible, on tab focus and on coming back online. Polling
  // only when visible: background tabs would otherwise wake the server for nobody.
  acc.attach = async (ctx) => {
    lib = ctx.lib; store = ctx.store; flush = ctx.flush || flush;
    if (!remote) return;
    since = (await store.getMeta('rev')) || 0;
    lib.on((c) => { if (c.origin === 'local') schedule(1500); });
    setInterval(() => { if (document.visibilityState === 'visible') run(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(200); });
    window.addEventListener('online', () => schedule(200));
    if (kind === 'origin') remote.session().then((s) => { if (s && s.features) { acc.features = s.features; S.features.meta = !!s.features.meta; S.features.public = !!s.features.public; } }).catch(() => {});
    run();
  };
  acc.syncNow = () => run();
  acc.onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  acc.meta = (url) => (remote && acc.features.meta ? remote.meta(url) : Promise.resolve(null));

  // Header chip.
  // Rebuilt on every status change; title doubles as aria-label because the visible text is hidden on phones (CSS).
  function paintChip() {
    if (!chipEl) return;
    const st = acc.status;
    const ic = { ok: 'cloud', idle: 'cloud', syncing: 'sync', offline: 'cloudOff', error: 'warn', auth: 'warn', none: 'cloudOff' }[st] || 'cloud';
    const text = st === 'ok' ? (acc.pending ? t('bm.sync.pending', { n: acc.pending }) : t('bm.sync.ok')) : t('bm.sync.' + st, { n: acc.pending });
    chipEl.className = 'bm-chip-sync bm-st-' + st;
    chipEl.textContent = '';
    chipEl.append(iconEl(ic), h('span', { class: 'bm-chip-t' }, text));
    chipEl.title = [text, acc.last ? t('bm.sync.last', { when: when(acc.last) }) : '', acc.error].filter(Boolean).join(' · ');
    chipEl.setAttribute('aria-label', chipEl.title);
  }
  acc.chip = () => {
    if (kind === 'none') return null;
    chipEl = h('button', { type: 'button', class: 'bm-chip-sync', 'aria-haspopup': 'menu', onclick: () => {
      openMenu(chipEl, [
        { header: true, label: `${acc.user} · ${hostLabel()}` },
        { label: t('bm.sync.now'), icon: 'sync', action: () => run() },
        acc.status === 'auth' && kind === 'origin' ? { label: t('bm.auth.login.go'), icon: 'user', action: () => location.reload() } : null,
        { label: t('ap.settings'), icon: 'settings', action: () => UI.settings() },
        { sep: true },
        { label: t(kind === 'token' ? 'bm.acc.disconnect' : 'bm.acc.logout'), icon: 'external', action: () => signOut() },
      ]);
    } });
    paintChip();
    return chipEl;
  };
  const hostLabel = () => { try { return new URL(server).host; } catch { return server; } };

  // Sign-out keeps the local copy by default (it is the offline cache). Unsynced edits get a second confirmation:
  // they are lost for the account if the user wipes or never comes back.
  async function signOut() {
    const label = t(kind === 'token' ? 'bm.acc.disconnect' : 'bm.acc.logout');
    const wipe = h('input', { type: 'checkbox' });
    const r = await openDialog({
      title: label, body: h('div', { class: 'ed-fields' }, h('p', { class: 'ed-dlg-text' }, t(kind === 'token' ? 'bm.acc.disconnectText' : 'bm.acc.logoutText', { server: hostLabel() })),
        h('label', { class: 'bm-check-row' }, wipe, h('span', null, t('bm.acc.wipeLocal')))),
      buttons: [{ label: t('dlg.cancel'), value: null }, { label, value: 'ok', primary: true }],
    });
    if (r !== 'ok') return;
    if (acc.pending && !wipe.checked && !(await confirmDialog(label, t('bm.acc.pendingText', { n: acc.pending }), label, true))) return;
    try { await remote.logout(); } catch { /* signed out locally anyway */ }
    if (wipe.checked) await store.clear();
    // Token mode keeps the data in the plain local DB; rev reset so a later connect re-pulls the whole log.
    else if (kind === 'token') await store.setMeta('rev', 0);
    if (kind === 'token') localStorage.removeItem(REMOTE_KEY);
    else localStorage.removeItem('bm-last-user');
    // Reload instead of tearing down state in place: startAccount picks the right database from scratch.
    location.reload();
  }

  // --- settings section ---------------------------------------------------------------------------------------------------------
  acc.settingsSection = () => {
    const sec = h('section', { class: 'bm-set-sec bm-set-account' }, h('h3', null, t('bm.acc.title')));
    if (kind === 'none') { sec.append(connectForm()); return sec; }
    const st = h('p', { class: 'ed-hint', role: 'status' });
    const paintSt = () => { st.textContent = `${t('bm.acc.signedIn', { user: acc.user, server: hostLabel() })} · ${t('bm.sync.' + (acc.status === 'ok' ? 'ok' : acc.status), { n: acc.pending })}${acc.last ? ' · ' + t('bm.sync.last', { when: when(acc.last) }) : ''}`; };
    paintSt();
    acc.onStatus(paintSt);
    sec.append(st, h('div', { class: 'ap-actions' },
      h('button', { type: 'button', class: 'ed-btn', onclick: () => run() }, iconEl('sync'), t('bm.sync.now')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => changePassword() }, iconEl('key'), t('bm.acc.password')),
      h('button', { type: 'button', class: 'ed-btn', onclick: () => signOut() }, iconEl('external'), t(kind === 'token' ? 'bm.acc.disconnect' : 'bm.acc.logout'))));
    const base = server.replace(/\/+$/, '');
    // Public page and feed.
    if (acc.features.public !== false) {
      sec.append(h('h4', null, t('bm.acc.public')), h('p', { class: 'ed-hint' }, t('bm.acc.publicHint')),
        h('div', { class: 'bm-linkrow' }, h('code', null, `${base}/u/${acc.user}`), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => copyText(`${base}/u/${acc.user}`) }, iconEl('copy'), t('ap.copy'))),
        h('div', { class: 'bm-linkrow' }, h('code', null, `${base}/u/${acc.user}/feed`), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => copyText(`${base}/u/${acc.user}/feed`) }, iconEl('copy'), t('ap.copy'))));
    }
    // Bookmarklet.
    const code = bookmarklet(base);
    const link = h('a', { class: 'bm-bookmarklet', href: code, onclick: (e) => { e.preventDefault(); toast(t('bm.acc.bookmarkletDrag'), 'info'); } }, iconEl('bookmark'), t('bm.acc.bookmarkletName'));
    sec.append(h('h4', null, t('bm.acc.bookmarklet')), h('p', { class: 'ed-hint' }, t('bm.acc.bookmarkletHint')),
      h('div', { class: 'bm-linkrow' }, link, h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => copyText(code) }, iconEl('copy'), t('bm.acc.copyCode'))));
    sec.append(tokensBlock());
    if (acc.role === 'owner') sec.append(ownerBlock(base));
    return sec;
  };

  // Standalone file -> remote server. Defaults to https; plain http is allowed but warned about except for
  // loopback hosts, where traffic never leaves the machine.
  function connectForm() {
    const url = h('input', { type: 'url', class: 'ed-input', placeholder: 'https://bookmarks.example.org', value: lsGet('bm-last-server', ''), inputmode: 'url', spellcheck: 'false' });
    url.id = 'bm-srv';
    const out = h('div', { class: 'bm-connect-out' });
    const go = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('plug'), t('bm.acc.connect'));
    go.addEventListener('click', async () => {
      let base = url.value.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
      out.textContent = '';
      let u;
      try { u = new URL(base); } catch { out.append(h('p', { class: 'ed-error' }, t('bm.acc.badServer'))); return; }
      const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
      if (u.protocol !== 'https:' && !local) out.append(h('p', { class: 'ed-hint ed-hint-warn' }, t('bm.acc.insecure')));
      const r = createRemote({ base: u.origin + u.pathname.replace(/\/+$/, ''), token: '' });
      go.disabled = true;
      let info;
      try { info = await r.info(); } catch (e) { out.append(h('p', { class: 'ed-error' }, t('bm.acc.noServer', { msg: errText(e) }))); go.disabled = false; return; }
      go.disabled = false;
      // Identify the service before sending a password: a typo in the address must not post credentials to an
      // arbitrary site that happens to answer /api/info.
      if (!info || info.service !== 'in-html bookmarks') { out.append(h('p', { class: 'ed-error' }, t('bm.acc.notOurs'))); return; }
      lsSet('bm-last-server', r.base);
      out.append(authForm(info.setup ? 'setup' : 'login', {
        remote: r, server: u.host, wantToken: true, onIn: async (res) => {
          if (!res || !res.token) { out.append(h('p', { class: 'ed-error' }, t('bm.err.generic', { msg: 'no token' }))); return; }
          const n = S.lib ? S.lib.stats().total : 0;
          if (n && !(await confirmDialog(t('bm.acc.connect'), t('bm.acc.mergeLocal', { n, server: u.host }), t('bm.acc.connect')))) return;
          lsSet(REMOTE_KEY, { server: r.base, user: res.user.name, role: res.user.role, token: res.token });
          await S.store.setMeta('rev', 0);
          // Everything kept here so far goes to the account.
          // Every local record marked dirty, so the first sync uploads the local library into the account (merge).
          await S.store.put(S.lib.allRecords(), { dirty: true });
          location.reload();
        },
      }));
    });
    return h('div', { class: 'ed-fields' }, h('p', { class: 'ed-hint' }, t('bm.acc.connectHint')),
      h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: 'bm-srv' }, t('bm.acc.server')), h('div', { class: 'ed-row' }, url, go)), out);
  }

  async function changePassword() {
    const old = await promptPassword(t('bm.acc.password'), t('bm.acc.oldPassword'));
    if (!old) return;
    const next = await promptPassword(t('bm.acc.password'), t('bm.acc.newPassword'));
    if (!next) return;
    try { await remote.password(old, next); toast(t('bm.acc.passwordChanged'), 'ok'); } catch (e) { toast(errText(e), 'error'); }
  }

  // Tokens are listed without their secret; a new token is shown once, right after creation (server stores a hash).
  function tokensBlock() {
    const box = h('div', { class: 'bm-tokens' });
    const paint = async () => {
      box.textContent = '';
      box.append(h('h4', null, t('bm.acc.tokens')), h('p', { class: 'ed-hint' }, t('bm.acc.tokensHint')));
      let list = [];
      try { list = await remote.tokens(); } catch (e) { box.append(h('p', { class: 'ed-error' }, errText(e))); return; }
      box.append(h('ul', { class: 'bm-rows' }, list.map((x) => h('li', null,
        iconEl(x.kind === 'api' ? 'key' : 'laptop'), h('span', { class: 'bm-rows-t' }, (x.label || (x.kind === 'api' ? t('bm.acc.token') : t('bm.acc.browser'))).slice(0, 60),
          h('small', null, `${t('bm.acc.created', { date: dateText(x.created) })} · ${t('bm.acc.used', { when: when(x.used) })}${x.current ? ' · ' + t('bm.acc.current') : ''}`)),
        x.current ? null : h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: async () => { try { await remote.revokeToken(x.id); paint(); } catch (e) { toast(errText(e), 'error'); } } }, t('bm.acc.revoke'))))),
      h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
        const label = await promptDialog(t('bm.acc.newToken'), t('bm.acc.tokenName'), 'script');
        if (!label) return;
        try {
          const r = await remote.createToken(label);
          box.append(h('div', { class: 'bm-linkrow bm-secret' }, h('code', null, r.token), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => copyText(r.token) }, iconEl('copy'), t('ap.copy'))),
            h('p', { class: 'ed-hint ed-hint-warn' }, t('bm.acc.tokenOnce')));
        } catch (e) { toast(errText(e), 'error'); }
      } }, iconEl('plus'), t('bm.acc.newToken')));
    };
    paint();
    return box;
  }

  function ownerBlock(base) {
    const box = h('div', { class: 'bm-owner' });
    const paint = async () => {
      box.textContent = '';
      box.append(h('h4', null, t('bm.own.users')));
      try {
        const users = await remote.users();
        box.append(h('ul', { class: 'bm-rows' }, users.map((u) => h('li', null, iconEl('user'),
          h('span', { class: 'bm-rows-t' }, u.name, h('small', null, `${t('bm.own.role.' + u.role)} · ${t('bm.own.count', { n: u.bookmarks })} · ${dateText(u.created)}`)),
          u.me ? null : h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: async () => {
            if (!(await confirmDialog(t('bm.own.delete'), t('bm.own.deleteText', { name: u.name, n: u.bookmarks }), t('dlg.delete'), true))) return;
            try { await remote.deleteUser(u.name); paint(); } catch (e) { toast(errText(e), 'error'); }
          } }, t('dlg.delete'))))));
        const invites = await remote.invites();
        box.append(h('h4', null, t('bm.own.invites')), h('p', { class: 'ed-hint' }, t('bm.own.invitesHint')));
        if (invites.length) box.append(h('ul', { class: 'bm-rows' }, invites.map((x) => h('li', null, iconEl('mail'),
          h('span', { class: 'bm-rows-t' }, t('bm.own.invite'), h('small', null, t('bm.own.expires', { date: dateText(x.expires, true) }))),
          h('button', { type: 'button', class: 'ed-btn ed-sm ed-danger', onclick: async () => { await remote.deleteInvite(x.id).catch(() => {}); paint(); } }, t('bm.acc.revoke'))))));
        const linkBox = h('div');
        box.append(h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: async () => {
          try {
            const r = await remote.createInvite(7);
            const page = kind === 'origin' ? location.origin + location.pathname : base + '/';
            const link = `${page}#invite=${r.token}`;
            linkBox.textContent = '';
            linkBox.append(h('div', { class: 'bm-linkrow bm-secret' }, h('code', null, link), h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => copyText(link) }, iconEl('copy'), t('ap.copy'))),
              h('p', { class: 'ed-hint' }, t('bm.own.inviteOnce', { date: dateText(r.expires, true) })));
          } catch (e) { toast(errText(e), 'error'); }
        } }, iconEl('plus'), t('bm.own.newInvite')), linkBox);
        const cfg = await remote.config();
        // A switch per server option. `locked` = fixed by the server's config file, shown disabled with a note.
        // On failure the checkbox flips back: the UI never claims a state the server rejected.
        const sw = (key, label, hint) => {
          const c = h('input', { type: 'checkbox', class: 'ed-switch', role: 'switch', checked: !!cfg[key], disabled: !!(cfg.locked && cfg.locked[key]) || (key === 'fetchMeta' && !cfg.canFetch) });
          c.addEventListener('change', async () => { try { const r = await remote.saveConfig({ [key]: c.checked }); Object.assign(cfg, r); if (key === 'fetchMeta') { acc.features.meta = r.fetchMeta; S.features.meta = r.fetchMeta; } toast(t('bm.own.saved'), 'ok'); } catch (e) { c.checked = !c.checked; toast(errText(e), 'error'); } });
          return h('div', { class: 'ed-field ed-field-check' }, c, h('label', { class: 'ed-label', onclick: () => c.click() }, label), h('div', { class: 'ed-hint' }, hint + (cfg.locked && cfg.locked[key] ? ' ' + t('bm.own.locked') : '')));
        };
        const origins = h('textarea', { class: 'ed-input ed-textarea ed-code', rows: '3', spellcheck: 'false', disabled: !!(cfg.locked && cfg.locked.cors) }, (cfg.cors || []).join('\n'));
        // Set .value as well: the textarea child text is only its default value; .value is what the user edits.
        origins.value = (cfg.cors || []).join('\n');
        box.append(h('h4', null, t('bm.own.server')),
          sw('fetchMeta', t('bm.own.fetchMeta'), t('bm.own.fetchMetaHint')),
          sw('publicPages', t('bm.own.publicPages'), t('bm.own.publicPagesHint')),
          h('div', { class: 'ed-field' }, h('label', { class: 'ed-label' }, t('bm.own.cors')), origins, h('div', { class: 'ed-hint' }, t('bm.own.corsHint'))),
          h('button', { type: 'button', class: 'ed-btn ed-sm', disabled: !!(cfg.locked && cfg.locked.cors), onclick: async () => {
            try { const r = await remote.saveConfig({ cors: origins.value.split(/\s+/).filter(Boolean) }); origins.value = r.cors.join('\n'); toast(t('bm.own.saved'), 'ok'); } catch (e) { toast(errText(e), 'error'); }
          } }, iconEl('save'), t('ap.save')));
      } catch (e) { box.append(h('p', { class: 'ed-error' }, errText(e))); }
    };
    paint();
    return box;
  }
  return acc;
}

async function promptPassword(title, label) {
  const inp = h('input', { type: 'password', class: 'ed-input', autocomplete: 'off', 'aria-label': label });
  const r = await openDialog({ title, body: h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, label), inp), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  return r === 'ok' && inp.value ? inp.value : null;
}

// A javascript: link for the bookmarks bar: opens <server>/add with this page in a small window.
// Built as a string at runtime (not a literal) because the server URL is only known here. JSON.stringify quotes and
// escapes the URL for the embedded JS. The selection is capped at 2000 chars to keep the URL short. When popups are
// blocked, w.open returns null and the page navigates to /add itself.
export function bookmarklet(base) {
  return `javascript:(function(){var d=document,w=window,s=String(w.getSelection?w.getSelection():'').slice(0,2000),u=${JSON.stringify(base + '/add')}+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(d.title)+'&selection='+encodeURIComponent(s);if(!w.open(u,'bmadd','width=620,height=680,scrollbars=yes'))location.href=u;})()`;
}

