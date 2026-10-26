// ethereum-wallet/settings.js - settings: the chain (ethereum/chains.js presets), the JSON-RPC endpoint of each chain
// (presets are only listed, nothing is contacted before the user picks one; this site's own proxy when the page is
// served by the backend), the vault (auto-lock, password, backup), this build's mode and the privacy statement.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { field, select } from '../ui/app.js';
import { endpointPicker } from '../walletui/endpoints.js';
import { vaultSettings } from '../walletui/lock.js';
import { section, kv, MODE, OFFLINE } from '../walletui/shell.js';
import { createRpcClient } from '../ethereum/rpc.js';
import { settings, saveSettings, setEndpoint, endpointOf, backendInfo, backendRpcUrl, vault, clearRuntime, chain, CHAIN_LIST } from './state.js';

// Labels starting with '=' are literal text for select(), not i18n keys (chain names are proper nouns).
const chainLabel = (c) => `${c.name} · ${c.id}${c.testnet ? ' · testnet' : ''}${c.deprecated ? ' · deprecated' : ''}`;

// Rebuilt from scratch on every change (ctx.rerender): few controls, and a full render avoids stale derived values
// (endpoint presets, fee model) after a chain switch. clearRuntime drops cached balances/blocks of the old chain.
export function renderSettings(ctx) {
  const c = chain();
  const sel = select(CHAIN_LIST.map((x) => ({ v: x.id, l: '=' + chainLabel(x) })), settings.chainId, (v) => { settings.chainId = +v; saveSettings(); clearRuntime(); ctx.rerender(); });
  ctx.view.append(h('div', { class: 'wu-grid2' },
    section(t('eth.general'), field('eth.chain', sel), kv([[t('eth.currency'), `${c.currency.name} (${c.currency.symbol})`], [t('eth.feeModel'), c.eip1559 === false ? t('eth.legacy') : 'EIP-1559'],
      c.explorer ? [t('eth.publicExplorer'), c.explorer] : null]), h('p', { class: 'wu-small wu-muted' }, t('eth.chainNote'))),
    OFFLINE ? section(t('eth.endpoint'), h('p', null, t('eth.offlineBuild'))) : section(t('eth.endpointFor', { chain: c.name }), endpointPicker({
      presets: c.rpc.map((url) => ({ name: new URL(url).host, url })), value: endpointOf(), kind: 'JSON-RPC',
      // The site's own proxy is offered only when the backend serves the same chain; otherwise it would be a wrong-chain RPC.
      backendUrl: backendInfo && backendInfo.chainId === settings.chainId ? backendRpcUrl() : null,
      onChange: (url) => { setEndpoint(url); clearRuntime(); ctx.rerender(); },
      // The test compares eth_chainId with the selected chain: a wrong-chain RPC would show wrong balances, and transactions
      // signed for chain A (EIP-155 chain id) are rejected by chain B at best.
      test: async (url) => {
        const client = createRpcClient({ url, timeout: 10000 });
        const [id, n] = await Promise.all([client.chainId(), client.blockNumber()]);
        if (id !== settings.chainId) throw new Error(t('eth.chainMismatch', { got: id, want: settings.chainId }));
        return t('eth.endpointInfo', { id, n: String(n) });
      },
    })),
    section(t('eth.vault'), vaultSettings({ vault, fileName: 'ethereum-wallet-vault.json', onLockChange: (m) => { settings.autoLock = m; saveSettings(); } })),
    section(t('eth.about'), kv([[t('eth.build'), t('eth.mode.' + MODE)], backendInfo ? [t('eth.backend'), `${backendInfo.upstream || '—'} · ${t('eth.chainId')} ${backendInfo.chainId} · ${t('eth.head')} ${backendInfo.head ?? '—'}`] : null]),
      h('p', { class: 'wu-small', 'data-privacy': '' }, t('eth.privacy')), h('p', { class: 'wu-small wu-muted' }, t('eth.noWarranty')))));
}
