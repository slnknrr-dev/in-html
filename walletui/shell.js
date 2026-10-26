// walletui/shell.js - the frame shared by the wallet applications: the artifact mode (offline cold wallet, serverless,
// backend, development), hash routes (#/wallet/send, #/explorer/tx/<id>, …), the section tabs (top bar on desktop,
// bottom bar on phones), and small view helpers.
//
//   ARTIFACT ({ mode, singlefile, servers }), MODE: 'offline' | 'serverless' | 'backend' | 'standalone' | 'dev', OFFLINE
//   route() -> { parts: [..], query: URLSearchParams }, go(path, { replace }), onRoute(fn) -> unsubscribe
//   tabBar(items: [{ id, label, icon }], active) -> <nav>
//   section(title, ...children), kv([[label, value]…]) -> <dl>, busy(button, promise) -> promise (disables while running)
//   statusLine(kind, text) -> element, linkTo(path, text) -> <a href="#/…">, mono(text), copyable(text, display)
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { copyText } from '../ui/app.js';

// The build injects globalThis.IN_HTML_ARTIFACT describing which variant this file is; without it (running from
// sources) the app is in 'dev' mode.
export const ARTIFACT = (typeof globalThis !== 'undefined' && globalThis.IN_HTML_ARTIFACT) || { mode: 'dev', singlefile: false, servers: [] };
export const MODE = ARTIFACT.mode || 'dev';
export const OFFLINE = MODE === 'offline';

export function route() {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } }), query: new URLSearchParams(q) };
}

// replaceState does not fire hashchange, hence the manual event.
// KNOWN DEFECT: when location.hash is assigned, the browser fires hashchange itself and the manual dispatch fires a
// second one, so route handlers run twice per navigation. Fix: dispatch only in the replace branch.
export function go(path, { replace = false } = {}) {
  const target = '#/' + String(path).replace(/^[#/]+/, '');
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) location.hash = target;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function onRoute(fn) {
  const f = () => fn(route());
  window.addEventListener('hashchange', f);
  return () => window.removeEventListener('hashchange', f);
}

export function tabBar(items, active) {
  return h('nav', { class: 'wu-tabs', 'aria-label': t('wu.sections') }, items.map((it) => h('a', {
    href: '#/' + it.id, class: 'wu-tab' + (it.id === active ? ' wu-on' : ''), 'aria-current': it.id === active ? 'page' : null,
  }, iconEl(it.icon), h('span', null, it.label))));
}

export const section = (title, ...kids) => h('section', { class: 'ap-card wu-card' }, title ? h('h2', { class: 'ap-card-h' }, title) : null, ...kids);

export const kv = (pairs) => h('dl', { class: 'ap-kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));

// Restores the previous disabled state (not plain false), so a button that was disabled for another reason stays so.
export async function busy(btn, promise) {
  const was = btn.disabled;
  btn.disabled = true;
  btn.classList.add('wu-busy');
  try { return await promise; } finally { btn.disabled = was; btn.classList.remove('wu-busy'); }
}

export const statusLine = (kind, text) => h('div', { class: 'wu-status wu-' + kind, role: kind === 'error' ? 'alert' : 'status' }, iconEl(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn'), h('span', null, text));

export const linkTo = (path, text) => h('a', { href: '#/' + path, class: 'wu-link' }, text);

export const mono = (text, cls = '') => h('span', { class: 'wu-mono wu-break ' + cls }, text);

export const copyable = (text, display = text) => h('span', { class: 'wu-copyable' }, mono(display),
  h('button', { type: 'button', class: 'ed-iconbtn wu-mini', title: t('ap.copy'), 'aria-label': t('ap.copy'), onclick: () => copyText(text) }, iconEl('copy')));
