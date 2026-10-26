// walletui/endpoints.js - choosing the server a wallet talks to: presets are only listed (nothing is contacted before
// the user picks one and accepts the privacy note), a custom URL, the application's own backend when the page is
// served by it, and "disconnect". The choice is stored by the application (not secret).
//
//   endpointPicker({ presets: [{ name, url }], value, onChange(url | ''), kind, backendUrl, test(url) -> Promise<text> })
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { confirmDialog, toast } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';

// Privacy by default: listing presets contacts nothing; a server sees the user's IP and every looked-up address, so
// connecting requires explicit confirmation (skipped only for the page's own backend, which already saw the IP).
export function endpointPicker({ presets = [], value = '', onChange, kind = 'API', backendUrl = null, test = null }) {
  const root = h('div', { class: 'wu-col' });
  const use = async (url) => {
    if (url && url !== backendUrl && !(await confirmDialog(t('wu.endpointConfirm'), t('wu.endpointPrivacy', { url }), t('wu.connect')))) return;
    onChange(url);
    if (url && test) {
      try { toast(t('wu.endpointOk', { info: await test(url) }), 'ok'); } catch (e) { toast(t('wu.endpointFail', { msg: e.message }), 'error'); }
    }
  };
  const current = h('div', { class: 'wu-endpoint' }, iconEl(value ? 'globe' : 'shield'),
    h('div', { class: 'wu-col wu-tight' }, h('b', null, value ? t('wu.connectedTo') : t('wu.notConnected')), value ? h('span', { class: 'wu-mono wu-small wu-break' }, value) : h('span', { class: 'wu-small wu-muted' }, t('wu.notConnectedText'))),
    value ? h('button', { type: 'button', class: 'ed-btn', onclick: () => use('') }, t('wu.disconnect')) : null);
  const list = h('div', { class: 'wu-list' });
  if (backendUrl) list.append(h('div', { class: 'wu-item' }, h('div', { class: 'wu-item-main' }, h('b', null, t('wu.ownBackend')), h('span', { class: 'wu-mono wu-small' }, backendUrl)),
    h('button', { type: 'button', class: 'ed-btn', disabled: value === backendUrl, onclick: () => use(backendUrl) }, t('wu.use'))));
  for (const p of presets) {
    list.append(h('div', { class: 'wu-item' }, h('div', { class: 'wu-item-main' }, h('b', null, p.name), h('span', { class: 'wu-mono wu-small wu-break' }, p.url)),
      h('button', { type: 'button', class: 'ed-btn', disabled: value === p.url, onclick: () => use(p.url) }, t('wu.use'))));
  }
  const custom = h('input', { class: 'ed-input wu-mono', type: 'url', placeholder: 'https://…', 'aria-label': t('wu.customUrl', { kind }) });
  const add = h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => {
    const u = custom.value.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) { toast(t('wu.badUrl'), 'warn'); return; }
    use(u.replace(/\/+$/, ''));
  } }, t('wu.connect'));
  root.append(current, h('div', { class: 'wu-small wu-muted' }, t('wu.presetsNote')), list,
    h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('wu.customUrl', { kind })), h('div', { class: 'ap-row wu-nowrap' }, custom, add)));
  return root;
}
