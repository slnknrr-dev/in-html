// funding-studio/editor-server.js - the Server tab: the backend that exported pages talk to (doc.server: its URL and
// live figures), publishing the project to a funding-studio server (PUT api/admin/sites/<id> with the admin token,
// kept in this tab's session storage only) and the way to its admin console. When the studio itself is served by such
// a server, that server is found automatically (GET api/info next to the page).
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { S } from '../studio/state.js';
import { fullDoc } from '../studio/doc.js';
import { section } from '../studio/fields.js';
import { fieldsBox } from '../studio/right.js';
import { httpFetch } from './net.js';

const TOKEN_KEY = 'fd-admin-token';
let found = undefined; // undefined: not probed; null: none; { base, info }

// Memoised probe (undefined = not yet, null = none): is the editor served by a funding backend? Only over http(s);
// identified by the app name in api/info, so an unrelated server with an /api/info route is not mistaken for one.
export async function probeOwnServer() {
  if (found !== undefined) return found;
  found = null;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return found;
  try {
    const base = new URL('./', location.href).href;
    const r = await httpFetch(base + 'api/info', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    if (j && j.app === 'funding-studio') found = { base, info: j };
  } catch { /* static hosting */ }
  return found;
}

// Same session key as the admin console (admin.js), so signing in once in a tab serves both pages; sessionStorage so
// the token dies with the tab. normBase keeps origin + path (drops query/fragment) and guarantees a trailing slash.
const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (v) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* blocked */ } };
const normBase = (u) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/*$/, '/'); } catch { return ''; } };

// Publishing = PUT the full document (fullDoc includes attachments) under its id; the server normalises it again and
// keeps the slug of an earlier publication. The token goes only to the URL the owner typed - never to a URL taken
// from the document.
export async function publish(base, token) {
  const doc = fullDoc();
  const r = await httpFetch(base + 'api/admin/sites/' + encodeURIComponent(doc.id), {
    method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ doc }),
  });
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw Object.assign(new Error((j && j.error) || 'HTTP ' + r.status), { status: r.status, body: j });
  return j;
}

export function dsServer(body) {
  body.append(h('p', { class: 'ed-hint' }, t('sv.intro')));
  body.append(section('sv-url', t('sv.connect'), fieldsBox([
    { key: 'url', type: 'text', inputType: 'url', label: 'sv.url', hint: 'sv.urlH', placeholderText: 'https://donate.example.org/' },
    { key: 'live', type: 'checkbox', label: 'sv.live', hint: 'sv.liveH' },
  ], 'server', 'none')));
  const box = h('div', { class: 'ed-fields' });
  const status = h('div', { class: 'ed-hint', role: 'status' });
  const baseIn = h('input', { type: 'url', class: 'ed-input', placeholder: 'https://…', value: S.doc.server.url || '', 'aria-label': t('sv.target') });
  const tokIn = h('input', { type: 'password', class: 'ed-input', autocomplete: 'off', value: getToken(), 'aria-label': t('sv.token') });
  const result = h('div', { class: 'ed-fd-pub' });
  const btn = h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: async () => {
    const base = normBase(baseIn.value);
    if (!base) { toast(t('sv.badUrl'), 'warn'); return; }
    if (!tokIn.value) { toast(t('sv.needToken'), 'warn'); return; }
    setToken(tokIn.value);
    btn.disabled = true;
    status.textContent = t('sv.publishing');
    try {
      const j = await publish(base, tokIn.value);
      status.textContent = t('sv.published');
      result.textContent = '';
      for (const p of (j && j.pages) || []) result.append(h('a', { href: base + p.url, target: '_blank', rel: 'noopener' }, base + p.url));
      toast(t('sv.published'), 'ok');
    } catch (e) {
      status.textContent = e.status === 401 ? t('sv.unauthorized') : e.status === 409 ? t('sv.conflict', { msg: e.message }) : t('sv.failed', { msg: e.message });
      toast(status.textContent, 'error');
    } finally { btn.disabled = false; }
  } }, iconEl('upload'), t('sv.publish'));
  const admin = h('a', { class: 'ed-btn', target: '_blank', rel: 'noopener', href: '#' }, iconEl('settings'), t('sv.admin'));
  const syncAdmin = () => { const b = normBase(baseIn.value); admin.href = b ? b + 'admin.html' : '#'; admin.hidden = !b; };
  baseIn.addEventListener('input', syncAdmin);
  syncAdmin();
  box.append(
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('sv.target')), baseIn),
    h('label', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('sv.token')), tokIn, h('span', { class: 'ed-hint' }, t('sv.tokenH'))),
    h('div', { class: 'ed-row' }, btn, admin), status, result);
  body.append(section('sv-pub', t('sv.publishT'), box));
  probeOwnServer().then((f) => {
    if (!f) return;
    if (!baseIn.value) { baseIn.value = f.base; syncAdmin(); }
    status.textContent = t('sv.found', { url: f.base });
  });
}
