// ethereum-wallet/dashboard.js - the dashboard of the current chain: the portfolio (ether and token balances of every
// account, the share of each), the balance history from the snapshots this app records at each refresh (stored in the
// vault, at most one point per 10 minutes per account) plus the series of the backend's watch index when the page is
// served by it, the gas tracker (base fee of the last 50 blocks from eth_feeHistory, priority fee percentiles, the
// suggested slow / normal / fast fees) and network statistics (chain id, latest block, block time, gas used, client).
//
// Four independent panels (portfolio, gas, network, backend series) each own a container and paint themselves when
// their RPC calls settle. Independent so one slow or unsupported method (eth_feeHistory on old nodes) never blocks
// the others; each catches its own errors and shows them in place.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, select } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';
import { backendCall } from '../walletui/net.js';
import { section, go, statusLine, busy, linkTo, mono } from '../walletui/shell.js';
import { lineChart, barChart, dataTable } from '../walletui/chart.js';
import { num, short } from '../walletui/format.js';
import { formatUnits } from '../ethereum/units.js';
import { suggestFees } from '../ethereum/fees.js';
import { settings, rpc, chain, allAccounts, tokensOf, snapshotsOf, backendInfo, accountLabel, symbolOf } from './state.js';
import { fmtEth, fmtToken, fmtGwei, balanceOf, refreshBalances, lang } from './common.js';

// Charts need Number; bigint wei is converted through the exact decimal string (formatUnits) and only then to a
// float. Precision loss at 8/4 decimals is acceptable for drawing, never used for amounts.
const ethNum = (wei) => Number(formatUnits(BigInt(wei), 18, { maxDecimals: 8 }));
const gweiNum = (wei) => Number(formatUnits(BigInt(wei), 9, { maxDecimals: 4 }));
// Axis labels: times of day for a series shorter than two days, dates otherwise (short enough for phones).
const dateFmtFor = (pts) => (pts.length && pts[pts.length - 1].x - pts[0].x < 2 * 86400
  ? (x) => new Date(x * 1000).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' })
  : (x) => new Date(x * 1000).toLocaleDateString(lang(), { month: 'short', day: 'numeric' }));

// The combined series of several accounts: at every snapshot time, the sum of each account's latest value.
// Merge-walk over k sorted lists: one cursor per list advances while its next point is <= the current time, so the
// total is O(total points) instead of a search per time and list. An account contributes only once its first point
// exists (idx >= 0) - before that it is unknown, not zero, but the sum treats it as absent.
export function combineSeries(lists) {
  const times = [...new Set(lists.flatMap((l) => l.map((p) => p[0])))].sort((a, b) => a - b);
  const idx = lists.map(() => -1);
  return times.map((tm) => {
    let sum = 0n;
    lists.forEach((l, k) => { while (idx[k] + 1 < l.length && l[idx[k] + 1][0] <= tm) idx[k]++; if (idx[k] >= 0) sum += BigInt(l[idx[k]][1]); });
    return { x: tm, y: ethNum(sum) };
  });
}

// Every async painter re-checks ctx.alive() after its awaits: the dashboard may have been left while the node
// answered, and painting into a discarded container would be wasted work (and was a source of flicker).
export async function renderDashboard(ctx) {
  const client = rpc();
  const c = chain();
  const accs = allAccounts();
  const head = h('div', { class: 'ap-row' }, h('h2', { class: 'wu-h' }, t('eth.tab.dashboard')), h('span', { class: 'wu-pill' }, c.name));
  ctx.view.append(head);
  if (!client) { ctx.view.append(section('', statusLine('info', t('eth.noEndpointText')), h('div', { class: 'ap-row wu-mt' }, button('eth.chooseEndpoint', 'globe', () => go('settings'))))); return; }
  const refresh = h('button', { type: 'button', class: 'ed-btn' }, iconEl('refresh'), t('eth.refresh'));
  head.append(h('span', { class: 'ed-spacer' }), refresh);
  const top = h('div', { class: 'wu-col' });
  const gas = h('div', { class: 'wu-col' }, statusLine('info', t('eth.loading')));
  const net = h('div', { class: 'wu-col' });
  const server = h('div', { class: 'wu-col' });
  ctx.view.append(top, gas, net, server);
  let chartAcc = '';
  const paintPortfolio = () => {
    top.textContent = '';
    const tokens = tokensOf();
    const rows = accs.map(({ w, acc }) => ({ w, acc, b: balanceOf(acc.address) }));
    const total = rows.reduce((s, r) => s + (r.b && r.b.wei != null ? r.b.wei : 0n), 0n);
    const tokTotals = tokens.map((tk) => ({ tk, sum: rows.reduce((s, r) => s + (r.b && r.b.tokens && r.b.tokens[tk.address] != null ? r.b.tokens[tk.address] : 0n), 0n) }));
    const lists = (chartAcc ? accs.filter((x) => x.acc.address === chartAcc) : accs).map(({ acc }) => snapshotsOf(acc.address));
    const series = combineSeries(lists);
    const now = Math.floor(Date.now() / 1000);
    // Extend the step chart to now with the last known value; otherwise the line would end at the last snapshot time.
    if (series.length && now > series[series.length - 1].x) series.push({ x: now, y: series[series.length - 1].y });
    const accSel = select([{ v: '', l: 'eth.allAccounts' }, ...accs.map(({ w, acc }) => ({ v: acc.address, l: '=' + accountLabel(w, acc) }))], chartAcc, (v) => { chartAcc = v; paintPortfolio(); });
    top.append(h('div', { class: 'wu-stats' },
      h('div', { class: 'wu-stat' }, h('span', null, t('eth.portfolio')), h('b', { 'data-portfolio': '' }, fmtEth(total))),
      h('div', { class: 'wu-stat' }, h('span', null, t('eth.accounts')), h('b', null, String(accs.length))),
      ...tokTotals.filter((x) => x.sum > 0n).slice(0, 4).map((x) => h('div', { class: 'wu-stat' }, h('span', null, x.tk.name || x.tk.symbol), h('b', null, fmtToken(x.sum, x.tk))))),
    h('div', { class: 'wu-grid2' },
      section(t('eth.balanceHistory'), accs.length > 1 ? accSel : null,
        series.length ? lineChart({ points: series, step: true, yFormat: (v) => num(v, lang(), 4), xFormat: dateFmtFor(series), label: t('eth.balanceHistory') }) : h('div', { class: 'ap-empty' }, t('eth.noSnapshots')),
        h('p', { class: 'wu-small wu-muted' }, t('eth.snapshotNote', { sym: symbolOf() }))),
      section(t('eth.accounts'), accs.length ? h('div', { class: 'wu-list' }, rows.map(({ w, acc, b }) => h('a', { class: 'wu-item', href: '#/wallet/' + w.id },
        h('div', { class: 'wu-item-main' }, h('b', null, accountLabel(w, acc)), h('span', { class: 'wu-small wu-muted wu-mono' }, short(acc.address, 8, 6))),
        h('span', { class: 'wu-item-side' }, b && b.wei != null ? fmtEth(b.wei) : '—'),
        total > 0n && b && b.wei != null ? h('span', { class: 'wu-pill' }, `${(Number((b.wei * 10000n) / total) / 100).toFixed(1)} %`) : null))) : h('div', { class: 'ap-empty' }, linkTo('wallet/new/create', t('eth.newWallet'))))),
    tokens.length ? section(t('eth.tokens'), dataTable(rows.flatMap(({ w, acc, b }) => tokens.map((tk) => (b && b.tokens && b.tokens[tk.address] ? [tk.symbol, accountLabel(w, acc), fmtToken(b.tokens[tk.address], tk)] : null)).filter(Boolean)),
      [t('eth.symbol'), t('eth.account'), t('eth.balance')])) : null);
  };
  // Errors from the refresh are toasted, then the portfolio repaints anyway with whatever is cached (stale values
  // are better than an empty panel).
  const loadBalances = (force = false) => (accs.length ? refreshBalances(accs.map((x) => x.acc.address), { force }).catch((e) => toast(e.message, 'error')) : Promise.resolve()).then(() => ctx.alive() && paintPortfolio());
  // eth_feeHistory(50 blocks, percentiles 10/50/90): one call yields base fees for the chart and priority-fee rewards
  // for the percentile bars. The bar value is the mean of each percentile column over the window - a smoothing choice:
  // a single block's p90 is noisy. suggestFees (ethereum/fees.js) derives slow/normal/fast from the same data.
  async function paintGas() {
    try {
      const fh = await client.feeHistory(50, 'latest', [10, 50, 90]);
      if (!ctx.alive()) return;
      gas.textContent = '';
      const oldest = Number(fh.oldestBlock);
      const bases = (fh.baseFeePerGas || []).filter((x) => x != null);
      if (!bases.length) { gas.append(section(t('eth.gasTracker'), statusLine('info', t('eth.noFeeHistory')))); return; }
      const s = suggestFees(fh);
      const rewards = fh.reward || [];
      const pct = [10, 50, 90].map((p, i) => {
        const col = rewards.map((r) => r[i]).filter((x) => x != null);
        return { label: `p${p}`, value: col.length ? gweiNum(col.reduce((a, b) => a + b, 0n) / BigInt(col.length)) : 0 };
      });
      gas.append(h('div', { class: 'wu-stats' },
        ['slow', 'normal', 'fast'].map((k) => h('div', { class: 'wu-stat' }, h('span', null, t('eth.fee.' + k)), h('b', null, fmtGwei(s[k].maxFeePerGas)), h('span', null, t('eth.priority') + ' ' + fmtGwei(s[k].maxPriorityFeePerGas))))),
      h('div', { class: 'wu-grid2' },
        section(t('eth.baseFeeChart', { n: (fh.gasUsedRatio || []).length || bases.length }), lineChart({ points: bases.map((b, i) => ({ x: oldest + i, y: gweiNum(b) })), yFormat: (v) => num(v, lang(), 2), xFormat: (x) => '#' + Math.round(x), label: t('eth.baseFee') }),
          h('div', { class: 'wu-small wu-muted' }, t('eth.baseFeeAxis'))),
        section(t('eth.priorityFees'), barChart({ bars: pct.map((p) => ({ ...p, title: `${p.label}: ${num(p.value, lang(), 3)} gwei` })), yFormat: (v) => num(v, lang(), 2), label: t('eth.priorityFees') }),
          h('div', { class: 'wu-small wu-muted' }, t('eth.priorityAxis')))));
      return fh;
    } catch (e) { if (ctx.alive()) { gas.textContent = ''; gas.append(section(t('eth.gasTracker'), statusLine('info', t('eth.noFeeHistory') + ' ' + e.message))); } return null; }
  }
  // Block time = timestamp delta over up to 20 blocks / count: one-block deltas are quantised (12 s slots, missed
  // slots) and misleading. Gas-used ratio prefers feeHistory (20 blocks) and falls back to the head block alone.
  // A chain-id mismatch is flagged here too: the endpoint may have been repointed after the settings test.
  async function paintNet() {
    try {
      const head = Number(await client.blockNumber());
      const back = Math.min(20, head);
      const [latest, older, chainId, version] = await Promise.all([client.getBlock(BigInt(head)), client.getBlock(BigInt(head - back)), client.chainId(), client.clientVersion().catch(() => null)]);
      const span = back ? (Number(latest.timestamp) - Number(older.timestamp)) / back : 0;
      const fh = await client.feeHistory(20, 'latest', []).catch(() => null);
      const ratios = fh ? fh.gasUsedRatio : [];
      const ratio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : Number(latest.gasUsed) / Number(latest.gasLimit || 1);
      if (!ctx.alive()) return;
      net.textContent = '';
      net.append(section(t('eth.networkStats'), h('div', { class: 'wu-stats' },
        h('div', { class: 'wu-stat' }, h('span', null, t('eth.chainId')), h('b', null, String(chainId))),
        h('div', { class: 'wu-stat' }, h('span', null, t('eth.latestBlock')), h('b', null, num(head, lang(), 0))),
        h('div', { class: 'wu-stat' }, h('span', null, t('eth.blockTime')), h('b', null, span ? `${span.toFixed(1)} s` : '—')),
        h('div', { class: 'wu-stat' }, h('span', null, t('eth.gasUsedRatio')), h('b', null, `${(ratio * 100).toFixed(1)} %`)),
        latest.baseFeePerGas != null ? h('div', { class: 'wu-stat' }, h('span', null, t('eth.baseFee')), h('b', null, fmtGwei(latest.baseFeePerGas))) : null),
      version ? h('div', { class: 'wu-small wu-muted wu-mt' }, t('eth.clientVersion') + ': ', mono(version)) : null,
      chainId !== settings.chainId ? statusLine('warn', t('eth.chainMismatch', { got: chainId, want: settings.chainId })) : null));
    } catch (e) { if (ctx.alive()) { net.textContent = ''; net.append(statusLine('error', e.message)); } }
  }
  // Backend watch index (optional, only when the backend serves this chain). Sequential fetches, capped at 5 lists:
  // a small admin feature; parallel requests would add load to the shared server for no visible gain.
  async function paintServer() {
    if (!backendInfo || backendInfo.chainId !== settings.chainId) return;
    try {
      const list = await backendCall('watch');
      if (!ctx.alive()) return;
      server.textContent = '';
      const mine = list.filter((x) => x.chainId === settings.chainId);
      if (!mine.length) return;
      const parts = [];
      for (const wl of mine.slice(0, 5)) {
        const d = await backendCall('watch/' + wl.id);
        const pts = (d.series || []).map((p) => ({ x: p.t, y: ethNum(p.wei) }));
        parts.push(section(t('eth.serverSeries', { label: wl.label || wl.id }), pts.length ? lineChart({ points: pts, step: true, yFormat: (v) => num(v, lang(), 4), xFormat: dateFmtFor(pts), label: wl.label }) : h('div', { class: 'ap-empty' }, t('eth.noSnapshots'))));
      }
      server.append(h('div', { class: 'wu-grid2' }, parts));
    } catch { /* the watch index is optional */ }
  }
  refresh.addEventListener('click', () => busy(refresh, Promise.all([loadBalances(true), paintGas(), paintNet(), paintServer()])));
  paintPortfolio();
  loadBalances();
  paintGas();
  paintNet();
  paintServer();
}
