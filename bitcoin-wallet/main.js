// bitcoin-wallet/main.js - the Bitcoin wallet, explorer and dashboard: application shell, vault lock screen, section
// routing (#/wallet, #/explorer, #/dashboard, #/tools, #/settings) and the artifact modes (offline cold wallet without
// any network code, serverless with user-chosen Esplora servers, backend with this site's own server).
//
// Rendering model: hash routing (#/tab/...) and a full re-render of the view on every route change, unlock, lock or
// language switch. Section renderers are async (they await sync and network); renderToken + ctx.alive() let a slow
// renderer detect that the user has already navigated away, so stale results are never appended to a newer view.
// Locked state short-circuits everything: no section code runs, nothing is fetched, without the vault password.
import './strings.js';
import { startApp, t } from '../ui/app.js';
import { $, h } from '../ui/dom.js';
import { addIcons } from '../ui/icons.js';
import { UI_STATE } from '../ui/i18n.js';
import { lockScreen } from '../walletui/lock.js';
import { MODE, OFFLINE, route, onRoute, tabBar } from '../walletui/shell.js';
import { probeBackend } from '../walletui/net.js';
import { APP, vault, emptyData, clearRuntime, setBackendInfo, settings, setEndpoint, backendEsplora, endpointOf } from './state.js';
import { renderWallet } from './wallet.js';
import { renderExplorer } from './explorer.js';
import { renderDashboard } from './dashboard.js';
import { renderTools } from './tools.js';
import { renderSettings } from './settings.js';

const LOGO = 'M9 3v3M13 3v3M9 18v3M13 18v3M6 6h8.5a3 3 0 0 1 0 6H6h9.5a3 3 0 0 1 0 6H6M8 6v12';
addIcons({ btc: LOGO, wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12l1 3M16 13.5h2', block: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12 3 7M12 12v10' });

const main = $('#main');

// Explorer and dashboard query a server; the offline (cold wallet) build hides them instead of showing dead tabs.
export const TABS = () => [
  { id: 'wallet', label: t('btc.tab.wallet'), icon: 'wallet' },
  ...(OFFLINE ? [] : [{ id: 'explorer', label: t('btc.tab.explorer'), icon: 'search' }, { id: 'dashboard', label: t('btc.tab.dashboard'), icon: 'chart' }]),
  { id: 'tools', label: t('btc.tab.tools'), icon: 'sliders' },
  { id: 'settings', label: t('btc.tab.settings'), icon: 'settings' },
];

let renderToken = 0;
export function render() {
  const token = ++renderToken;
  main.textContent = '';
  const app = h('div', { class: 'wu-app' });
  main.append(app);
  if (!vault.unlocked) {
    app.append(lockScreen({ vault, title: t('app.name'), emptyData, onUnlocked: () => { touchRefresh(); render(); } }));
    return;
  }
  const r = route();
  let tab = r.parts[0] || 'wallet';
  // Unknown or hidden tab (e.g. #/explorer in an offline build) falls back to the wallet instead of a blank page.
  if (!TABS().some((x) => x.id === tab)) tab = 'wallet';
  app.append(tabBar(TABS(), tab));
  const view = h('div', { class: 'wu-view wu-col' });
  app.append(view);
  const ctx = { view, route: r, rerender: render, alive: () => token === renderToken };
  const fn = { wallet: renderWallet, explorer: renderExplorer, dashboard: renderDashboard, tools: renderTools, settings: renderSettings }[tab];
  // Promise.resolve() handles sync and async renderers alike; an error is shown in the view, not swallowed.
  Promise.resolve(fn(ctx)).catch((e) => { console.error(e); view.append(h('div', { class: 'wu-status wu-error' }, String(e.message || e))); });
}

// Any user activity resets the auto-lock timer; passive listeners never block scrolling.
// KNOWN DEFECT: called on every unlock, so each unlock adds four more listeners (harmless work, but they pile up for
// the page's lifetime). Fix: register once at startup, or guard with a module-level flag.
function touchRefresh() {
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => vault.touch(), { passive: true });
}

// On lock: wipe master keys and caches first, then render the lock screen.
vault.onLock = () => { clearRuntime(); render(); };
// Returning to the tab counts as activity; a hidden tab still auto-locks by the timer.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') vault.touch(); });

startApp({
  key: 'btcw', name: 'app.name', logo: LOGO, pages: [],
  // The shell badge reflects the build mode: offline (no network code at all), serverless (user-chosen servers), or
  // none for backend builds.
  offline: OFFLINE ? true : MODE === 'serverless' ? 'serverless' : false,
  onLang: () => render(),
});
document.documentElement.lang = UI_STATE.lang;

onRoute(() => render());
render();

// The page served by this application's backend: its Esplora-compatible API is the default server.
// Probed after the first render, so the lock screen is not delayed by the network. The network follows the backend
// only when the user has not chosen a server (runtime only, not saved); an explicit choice is never overridden.
if (MODE === 'backend' || MODE === 'dev') probeBackend(APP).then((info) => {
  if (!info) return;
  setBackendInfo(info);
  if (info.network && info.network !== settings.network && !endpointOf()) { settings.network = info.network; }
  if (!endpointOf(info.network)) setEndpoint(backendEsplora(), info.network);
  render();
});
