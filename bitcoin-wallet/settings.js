// bitcoin-wallet/settings.js - settings: the network, the Esplora server of each network (presets are only listed,
// nothing is contacted before the user picks one), the amount unit, the address gap limit, the vault (auto-lock,
// password, backup), this build's mode and the privacy statement.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { field, select, seg } from '../ui/app.js';
import { NETWORKS, NETWORK_NAMES } from '../bitcoin/networks.js';
import { createEsploraClient } from '../bitcoin/esplora.js';
import { endpointPicker } from '../walletui/endpoints.js';
import { vaultSettings } from '../walletui/lock.js';
import { section, kv, MODE, OFFLINE } from '../walletui/shell.js';
import { settings, saveSettings, setEndpoint, endpointOf, backendInfo, backendEsplora, vault, clearRuntime } from './state.js';

// Network or gap-limit change invalidates every scan (different addresses / depth), hence clearRuntime(). Unit is
// display-only and needs no resync.
export function renderSettings(ctx) {
  const net = select(NETWORK_NAMES.map((n) => ({ v: n, l: '=' + NETWORKS[n].label })), settings.network, (v) => { settings.network = v; saveSettings(); clearRuntime(); ctx.rerender(); });
  const unit = seg([{ v: 'BTC', l: '=BTC' }, { v: 'mBTC', l: '=mBTC' }, { v: 'bits', l: '=bits' }, { v: 'sat', l: '=sat' }], settings.unit, (v) => { settings.unit = v; saveSettings(); });
  const gap = select([20, 50, 100, 200].map((n) => ({ v: n, l: '=' + n })), settings.gapLimit, (v) => { settings.gapLimit = +v; saveSettings(); clearRuntime(); });
  ctx.view.append(h('div', { class: 'wu-grid2' },
    section(t('btc.general'), field('btc.network', net), field('btc.unit', unit), field('btc.gapLimit', gap, 'btc.gapHint')),
    OFFLINE ? section(t('btc.server'), h('p', null, t('btc.offlineBuild'))) : section(t('btc.serverFor', { net: NETWORKS[settings.network].label }), endpointPicker({
      // Presets are shown, never contacted until chosen: listing a server must not leak the user's IP to it.
      presets: NETWORKS[settings.network].esplora, value: endpointOf(), kind: 'Esplora',
      backendUrl: backendInfo && backendInfo.network === settings.network ? backendEsplora() : null,
      onChange: (url) => { setEndpoint(url); clearRuntime(); ctx.rerender(); },
      // "Test" fetches only the tip height: proves the URL speaks Esplora without sending any wallet address.
      test: async (url) => `${t('btc.height')} ${await createEsploraClient({ url }).tipHeight()}`,
    })),
    section(t('btc.vault'), vaultSettings({ vault, fileName: 'bitcoin-wallet-vault.json', onLockChange: (m) => { settings.autoLock = m; saveSettings(); } })),
    section(t('btc.about'), kv([[t('btc.build'), t('btc.mode.' + MODE)], backendInfo ? [t('btc.backend'), `${backendInfo.source} · ${backendInfo.network}`] : null]),
      h('p', { class: 'wu-small' }, t('btc.privacy')), h('p', { class: 'wu-small wu-muted' }, t('btc.noWarranty')))));
}
