// ethereum-wallet/main.js - the Ethereum wallet, explorer and dashboard: application shell, vault lock screen, section
// routing (#/wallet, #/explorer, #/dashboard, #/tools, #/settings) and the artifact modes (offline cold wallet without
// any network code, serverless with user-chosen JSON-RPC endpoints, backend with this site's own node proxy).
// Strings first: registers i18n keys before any module below calls t().
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { $, h } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { lockScreen } from '../walletui/lock.js';
import { MODE, OFFLINE, route, onRoute, tabBar } from '../walletui/shell.js';
import { probeBackend } from '../walletui/net.js';
import { APP, vault, emptyData, upgradeData, clearRuntime, setBackendInfo, settings, saveSettings, setEndpoint, backendRpcUrl, endpointOf } from './state.js';
import { chainById } from '../ethereum/chains.js';
import { renderWallet } from './wallet.js';
import { renderExplorer } from './explorer.js';
import { renderDashboard } from './dashboard.js';
import { renderTools } from './tools.js';
import { renderSettings } from './settings.js';

const LOGO = 'M12 2 5 12.2 12 16.4 19 12.2zM5 13.6 12 22l7-8.4-7 4.2z';
addIcons({ eth: LOGO, wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12l1 3M16 13.5h2', block: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12 3 7M12 12v10' });

const main = $('#main');

// A function, not a constant: labels come from t() and must be re-read after a language switch. The offline build
// drops network tabs (explorer, dashboard) entirely - without a node they could only show errors.
export const TABS = () => [
  { id: 'wallet', label: t('eth.tab.wallet'), icon: 'wallet' },
  ...(OFFLINE ? [] : [{ id: 'explorer', label: t('eth.tab.explorer'), icon: 'search' }, { id: 'dashboard', label: t('eth.tab.dashboard'), icon: 'chart' }]),
  { id: 'tools', label: t('eth.tab.tools'), icon: 'sliders' },
  { id: 'settings', label: t('eth.tab.settings'), icon: 'settings' },
];

// Render generation counter. Views are async (RPC calls); a view whose promise settles after the user navigated away
// must not append into the new DOM, so it checks ctx.alive() (captured token === current token). An AbortController
// per render would need every RPC helper to accept a signal; a token check suffices because late results are only
// discarded, computing them is harmless.
let renderToken = 0;
export function render() {
  const token = ++renderToken;
  main.textContent = '';
  const app = h('div', { class: 'wu-app' });
  main.append(app);
  // Locked vault: only the lock screen is built, so no decrypted data can reach the DOM.
  if (!vault.unlocked) {
    app.append(lockScreen({ vault, title: t('app.name'), emptyData, onUnlocked: () => { upgradeData(); touchRefresh(); render(); } }));
    return;
  }
  const r = route();
  let tab = r.parts[0] || 'wallet';
  // Unknown or unavailable tab (e.g. #/explorer opened in the offline build) falls back to the wallet.
  if (!TABS().some((x) => x.id === tab)) tab = 'wallet';
  app.append(tabBar(TABS(), tab));
  const view = h('div', { class: 'wu-view wu-col' });
  app.append(view);
  const ctx = { view, route: r, rerender: render, alive: () => token === renderToken };
  const fn = { wallet: renderWallet, explorer: renderExplorer, dashboard: renderDashboard, tools: renderTools, settings: renderSettings }[tab];
  // Promise.resolve wraps sync and async views alike; errors render inline instead of an unhandled rejection.
  Promise.resolve(fn(ctx)).catch((e) => { console.error(e); if (ctx.alive()) view.append(h('div', { class: 'wu-status wu-error' }, String(e.message || e))); });
}

// Activity tracking for the auto-lock timer. Listeners are attached once (guard flag) and never removed: vault.touch()
// is a timestamp write, cheaper than re-registering on every unlock. passive:true keeps scrolling smooth.
let touching = false;
function touchRefresh() {
  if (touching) return;
  touching = true;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => vault.touch(), { passive: true });
}

// Auto-lock: drop runtime caches (balances, derived keys) and re-render, which shows the lock screen.
// visibilitychange: returning to the tab counts as activity (timers are throttled in background tabs).
vault.onLock = () => { clearRuntime(); render(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vault.touch(); });

// offline: true hides network UI; 'serverless' marks a build that talks only to user-chosen endpoints.
startApp({
  key: 'ethw', name: 'app.name', logo: LOGO, pages: [],
  offline: OFFLINE ? true : MODE === 'serverless' ? 'serverless' : false,
  onLang: () => render(),
});
// Sync <html lang> with the restored UI language (screen readers, hyphenation).
document.documentElement.lang = UI_STATE.lang;

onRoute(() => render());
render();

// The page served by this application's backend: its JSON-RPC proxy is the default endpoint of the backend's chain.
if (MODE === 'backend' || MODE === 'dev') probeBackend(APP).then((info) => {
  if (!info || !info.upstream || !info.chainId) return;
  setBackendInfo(info);
  // Adopt the backend's chain only for a fresh setup (no endpoint chosen yet): never override a user's choice.
  if (chainById(info.chainId) && info.chainId !== settings.chainId && !endpointOf()) { settings.chainId = info.chainId; saveSettings(); }
  if (!endpointOf(info.chainId)) setEndpoint(backendRpcUrl(), info.chainId);
  render();
});
