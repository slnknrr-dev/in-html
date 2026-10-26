// language-studio/account.js - accounts of the BACKEND build (and of the development server): sign-in, registration,
// and synchronisation of the progress document with the server (service.js). Offline and serverless builds get
// account.offline.js instead (bundle.js variant): the same exports without any network code.
//
//   await startAccount(mode) -> account | null      null: this page has no server (progress stays in the browser)
//   account: { info, user, dbName, pull() -> doc | null, push(doc) -> doc | null, signIn(kind), signOut(),
//              changePassword(), deleteAccount(), setRegistration(open) }
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, openDialog, toast } from '../ui/overlays.js';

export const networked = true;

class ApiError extends Error {
  constructor(status, code, message, data) { super(message || code); this.status = status; this.code = code; this.data = data; }
}

// One fetch wrapper for the whole API. Same-origin only (relative /api path, credentials: 'same-origin': the session
// cookie is never sent elsewhere), cache: 'no-store' (progress must never come from an HTTP cache), no referrer.
// Every failure becomes an ApiError with a code: 'network' when fetch itself fails, the server's error code otherwise,
// so errText can map known codes to translated messages and show the raw message for the rest.
async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method, cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new ApiError(0, 'network', String((e && e.message) || e)); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'http_' + res.status, (data && data.message) || res.statusText, data);
  return data;
}

const KNOWN = new Set(['wrong_login', 'rate', 'bad_name', 'bad_password', 'name_taken', 'closed', 'wrong_password', 'network', 'auth']);
export const errText = (e) => (e && KNOWN.has(e.code) ? t('ls.err.' + e.code, { s: (e.data && e.data.retry) || 60 }) : t('ls.err.generic', { msg: (e && e.message) || String(e) }));

// Sign-in / registration dialog. autocomplete tokens (username, current-password, new-password) let password managers
// fill and generate correctly; labels are bound with for/id. The submit handler only prevents navigation: the dialog's
// primary button runs go(), which keeps the dialog open (returns false) on an error and shows it in a role=alert line.
function authDialog(kind, registration) {
  const name = h('input', { type: 'text', class: 'ed-input', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', id: 'ls-a-name' });
  const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: kind === 'login' ? 'current-password' : 'new-password', id: 'ls-a-pw' });
  const pw2 = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password', id: 'ls-a-pw2' });
  const err = h('p', { class: 'ed-error', role: 'alert', hidden: true });
  const row = (label, input) => h('div', { class: 'ed-field' }, h('label', { class: 'ed-label', for: input.id }, label), input);
  let mode = kind;
  const body = h('form', { class: 'ls-auth', novalidate: true });
  const draw = () => {
    body.replaceChildren(
      h('p', { class: 'ed-hint' }, t(mode === 'login' ? 'ls.auth.loginLead' : 'ls.auth.registerLead')),
      row(t('ls.auth.name'), name), row(t('ls.auth.password'), pw), mode === 'register' ? row(t('ls.auth.password2'), pw2) : null,
      mode === 'register' ? h('p', { class: 'ed-hint' }, t('ls.auth.rules')) : null, err,
      registration || mode === 'register' ? h('button', { type: 'button', class: 'ed-btn ls-link', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; err.hidden = true; draw(); } }, t(mode === 'login' ? 'ls.auth.toRegister' : 'ls.auth.toLogin')) : null,
    );
  };
  draw();
  let result = null;
  const go = async () => {
    err.hidden = true;
    if (mode === 'register' && pw.value !== pw2.value) { err.textContent = t('ls.auth.mismatch'); err.hidden = false; return false; }
    try { result = await call('POST', mode === 'login' ? 'login' : 'register', { name: name.value.trim(), password: pw.value }); return true; } catch (ex) { err.textContent = errText(ex); err.hidden = false; return false; }
  };
  body.addEventListener('submit', (e) => e.preventDefault());
  return openDialog({
    title: t('ls.auth.title'), body,
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ls.auth.go'), primary: true, value: 'ok', onClick: go }],
  }).then((v) => (v === 'ok' ? result : null));
}

// Only backend and dev builds have a server; others return null without a request. A 401 on pull/push means the
// session expired: the account flips to signed-out locally instead of throwing into the page. dbName follows the
// user so the local IndexedDB copy is per account (store.js).
export async function startAccount(mode) {
  if (mode !== 'backend' && mode !== 'dev') return null;
  let info;
  try { info = await call('GET', 'info'); } catch { return null; }
  const acc = {
    info, user: info.user ? info.user.name : null, owner: !!(info.user && info.user.owner),
    get dbName() { return this.user ? 'language-studio@' + this.user : 'language-studio'; },
    async pull() { if (!this.user) return null; try { return (await call('GET', 'progress')).doc; } catch (e) { if (e.status === 401) this.user = null; return null; } },
    async push(doc) { if (!this.user) return null; try { return (await call('PUT', 'progress', { doc })).doc; } catch (e) { if (e.status === 401) this.user = null; return null; } },
    async signIn(kind = 'login') {
      const r = await authDialog(kind, info.registration);
      if (r && r.user) { this.user = r.user.name; this.owner = !!r.user.owner; return true; }
      return false;
    },
    async signOut() { try { await call('POST', 'logout', {}); } catch { /* signed out locally anyway */ } this.user = null; this.owner = false; },
    async changePassword() {
      const old = h('input', { type: 'password', class: 'ed-input', autocomplete: 'current-password' });
      const next = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password' });
      const v = await openDialog({ title: t('ls.acc.password'), body: h('div', null, h('label', { class: 'ed-label' }, t('ls.acc.old')), old, h('label', { class: 'ed-label' }, t('ls.acc.new')), next), buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('dlg.ok'), value: true, primary: true }] });
      if (!v) return;
      try { await call('POST', 'password', { old: old.value, new: next.value }); toast(t('ls.acc.passwordDone'), 'ok'); } catch (e) { toast(errText(e), 'error'); }
    },
    async deleteAccount() {
      const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: 'current-password' });
      const v = await openDialog({ title: t('ls.acc.delete'), body: h('div', null, h('p', null, t('ls.acc.deleteText')), h('label', { class: 'ed-label' }, t('ls.auth.password')), pw), buttons: [{ label: t('dlg.cancel'), value: false }, { label: t('ls.acc.delete'), value: true, primary: true, danger: true }] });
      if (!v) return false;
      try { await call('POST', 'delete', { password: pw.value }); this.user = null; return true; } catch (e) { toast(errText(e), 'error'); return false; }
    },
    async setRegistration(open) {
      if (!(await confirmDialog(t('ls.acc.registration'), t(open ? 'ls.acc.regOpenQ' : 'ls.acc.regCloseQ')))) return;
      try { info.registration = (await call('POST', 'registration', { open })).registration; } catch (e) { toast(errText(e), 'error'); }
    },
  };
  return acc;
}
