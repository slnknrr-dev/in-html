// bitcoin-wallet/dashboard.js - the dashboard: portfolio of the wallets of the current network, the combined balance
// history, every coin (UTXO) with its age and a size histogram, the fee market (estimates by confirmation target, the
// mempool fee histogram) and network statistics (height, block intervals, difficulty, mempool).
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';
import { section, go, statusLine, busy, linkTo, mono } from '../walletui/shell.js';
import { lineChart, barChart, dataTable } from '../walletui/chart.js';
import { num, ago, short } from '../walletui/format.js';
import { formatBtc } from '../bitcoin/units.js';
import { NETWORKS } from '../bitcoin/networks.js';
import { settings, source, walletsOfNetwork } from './state.js';
import { amt, syncWallet, walletState, lang } from './common.js';

//
// Two independent panels: the portfolio (local sync cache, repainted after syncs) and the network panel (server
// statistics). Each fails on its own: a fee-estimate outage does not hide balances, a sync error per wallet is a toast.
export async function renderDashboard(ctx) {
  const src = source();
  const ws = walletsOfNetwork();
  const head = h('div', { class: 'ap-row' }, h('h2', { class: 'wu-h' }, t('btc.tab.dashboard')), h('span', { class: 'wu-pill' }, NETWORKS[settings.network].label));
  ctx.view.append(head);
  if (!src) { ctx.view.append(section('', statusLine('info', t('btc.noServerText')), h('div', { class: 'ap-row wu-mt' }, button('btc.chooseServer', 'globe', () => go('settings'))))); return; }
  const refresh = h('button', { type: 'button', class: 'ed-btn' }, iconEl('refresh'), t('btc.refresh'));
  head.append(h('span', { class: 'ed-spacer' }), refresh);
  const top = h('div', { class: 'wu-col' });
  const net = h('div', { class: 'wu-col' }, statusLine('info', t('btc.loading')));
  ctx.view.append(top, net);
  const paintWallets = () => {
    top.textContent = '';
    const states = ws.map((w) => ({ w, s: walletState(w) }));
    const total = states.reduce((x, y) => x + (y.s.synced ? y.s.total : 0), 0);
    const pending = states.reduce((x, y) => x + (y.s.synced ? y.s.unconfirmed : 0), 0);
    // Combined balance history: the wallets' series merged by time.
    // Unconfirmed entries are placed at "now". A payment between two own wallets appears in both histories with
    // opposite nets, so the combined curve stays correct without deduplication.
    const events = states.flatMap(({ s }) => s.history.map((x) => ({ time: x.confirmed ? x.time : Math.floor(Date.now() / 1000), net: x.net }))).sort((a, b) => a.time - b.time);
    let bal = 0;
    const series = events.map((e) => ({ x: e.time, y: (bal += e.net) }));
    const coins = states.flatMap(({ w, s }) => s.utxos.map((u) => ({ ...u, wallet: w.name, tip: s.tip })));
    // Log-scale buckets in sats (10k, 100k, 1M, 10M, 1 BTC): coin sizes span orders of magnitude; linear buckets would
    // put almost every coin in the first bar.
    const buckets = [[0, 10000], [10000, 100000], [100000, 1000000], [1000000, 10000000], [10000000, 100000000], [100000000, Infinity]];
    const bucketLabel = ([a, b]) => (b === Infinity ? `≥${formatBtc(a)}` : `<${formatBtc(b)}`);
    top.append(h('div', { class: 'wu-stats' },
      h('div', { class: 'wu-stat' }, h('span', null, t('btc.portfolio')), h('b', null, amt(total))),
      h('div', { class: 'wu-stat' }, h('span', null, t('btc.pendingLabel')), h('b', null, amt(pending, { sign: true }))),
      h('div', { class: 'wu-stat' }, h('span', null, t('btc.walletsCount')), h('b', null, String(ws.length))),
      h('div', { class: 'wu-stat' }, h('span', null, t('btc.utxos')), h('b', null, String(coins.length)))),
      h('div', { class: 'wu-grid2' },
        section(t('btc.balanceHistory'), series.length > 1 ? lineChart({ points: series, step: true, yFormat: (v) => formatBtc(v, { group: true }), xFormat: (x) => new Date(x * 1000).toLocaleDateString(lang()), label: t('btc.balanceHistory') }) : h('div', { class: 'ap-empty' }, t('btc.noTx'))),
        section(t('btc.walletsTitle'), ws.length ? h('div', { class: 'wu-list' }, states.map(({ w, s }) => h('a', { class: 'wu-item', href: '#/wallet/' + w.id },
          h('div', { class: 'wu-item-main' }, h('b', null, w.name), h('span', { class: 'wu-small wu-muted' }, s.synced ? t('btc.txCount', { n: s.history.length }) : t('btc.notSynced'))),
          // Share of the portfolio per wallet (only when a total exists, avoiding division by zero).
          h('span', { class: 'wu-item-side' }, s.synced ? amt(s.total) : '—'), total && s.synced ? h('span', { class: 'wu-pill' }, `${Math.round((s.total / total) * 100)} %`) : null))) : h('div', { class: 'ap-empty' }, linkTo('wallet/new/create', t('btc.newWallet'))))),
      section(t('btc.utxoView'), coins.length ? h('div', { class: 'wu-col' },
        barChart({ bars: buckets.map((b) => ({ label: bucketLabel(b), value: coins.filter((u) => u.value >= b[0] && u.value < b[1]).length })), yFormat: (v) => String(Math.round(v)), label: t('btc.utxoSizes') }),
        dataTable(coins.sort((a, b) => b.value - a.value).slice(0, 100).map((u) => [amt(u.value), u.wallet, mono(short(u.address, 10, 8)), u.label || '', u.confirmed && u.tip ? String(u.tip - u.height + 1) : t('btc.unconfirmed')]),
          [t('btc.amount'), t('btc.wallet'), t('btc.address'), t('btc.label'), t('btc.confs')])) : h('div', { class: 'ap-empty' }, t('btc.noCoinsYet'))));
  };
  // Every wallet syncs in parallel; one failure must not block the others (caught per wallet).
  const syncAll = () => Promise.all(ws.map((w) => syncWallet(w).catch((e) => toast(`${w.name}: ${e.message}`, 'error')))).then(() => ctx.alive() && paintWallets());
  refresh.addEventListener('click', () => busy(refresh, Promise.all([...ws.map((w) => syncWallet(w, { force: true }).catch((e) => toast(e.message, 'error'))), paintNet()]).then(() => ctx.alive() && paintWallets())));
  paintWallets();
  syncAll();
  async function paintNet() {
    try {
      const [fees, mempool, blocks] = await Promise.all([src.feeEstimates(), src.mempool().catch(() => null), src.blocks()]);
      if (!ctx.alive()) return;
      net.textContent = '';
      // Only targets with readable labels: blocks below 6, hours below 144 (6 blocks/h), days above.
      const targets = Object.keys(fees).map(Number).sort((a, b) => a - b).filter((n) => [1, 2, 3, 4, 6, 10, 12, 24, 48, 144, 504, 1008].includes(n));
      // Average block interval from consecutive timestamps (newest first). Miner timestamps may be out of order, so
      // individual intervals can be negative; the average over 10 blocks still gives a usable figure.
      const intervals = blocks.slice(0, -1).map((b, i) => b.timestamp - blocks[i + 1].timestamp);
      const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
      const hist = mempool && mempool.fee_histogram ? mempool.fee_histogram : [];
      net.append(h('div', { class: 'wu-grid2' },
        section(t('btc.feeMarket'), barChart({ bars: targets.map((n) => ({ label: n < 6 ? `${n}` : n < 144 ? `${n / 6}h` : `${Math.round(n / 144)}d`, value: fees[n], title: t('btc.feeTarget', { n, rate: fees[n].toFixed(1) }) })), yFormat: (v) => v.toFixed(0), label: t('btc.feeMarket') }),
          h('div', { class: 'wu-small wu-muted' }, t('btc.feeAxis'))),
        // The 24 highest fee-rate buckets, reversed to ascending order for the chart's x-axis.
        section(t('btc.mempoolHist'), hist.length ? barChart({ bars: hist.slice(0, 24).reverse().map(([rate, vsize]) => ({ label: rate >= 10 ? Math.round(rate) + '' : rate.toFixed(1), value: vsize / 1e3, title: `${rate.toFixed(1)} sat/vB: ${num(vsize / 1e3, lang(), 0)} kvB` })), yFormat: (v) => num(v, lang(), 0), label: t('btc.mempoolHist') }) : h('div', { class: 'ap-empty' }, '—'),
          h('div', { class: 'wu-small wu-muted' }, t('btc.mempoolAxis')))),
      section(t('btc.networkStats'), h('div', { class: 'wu-stats' },
        h('div', { class: 'wu-stat' }, h('span', null, t('btc.height')), h('b', null, num(blocks[0].height, lang(), 0))),
        h('div', { class: 'wu-stat' }, h('span', null, t('btc.lastBlock')), h('b', null, ago(blocks[0].timestamp, lang()))),
        h('div', { class: 'wu-stat' }, h('span', null, t('btc.avgInterval')), h('b', null, `${(avg / 60).toFixed(1)} min`)),
        h('div', { class: 'wu-stat' }, h('span', null, t('btc.difficulty')), h('b', null, num(blocks[0].difficulty || 0, lang(), 0))),
        mempool ? h('div', { class: 'wu-stat' }, h('span', null, t('btc.mempoolTxs')), h('b', null, num(mempool.count, lang(), 0))) : null,
        mempool ? h('div', { class: 'wu-stat' }, h('span', null, t('btc.mempoolFees')), h('b', null, amt(mempool.total_fee))) : null)));
    } catch (e) { if (ctx.alive()) { net.textContent = ''; net.append(statusLine('error', e.message)); } }
  }
  paintNet();
}
