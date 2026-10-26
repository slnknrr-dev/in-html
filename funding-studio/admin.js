// funding-studio/admin.js - the admin console of the funding backend (admin.html): sign-in with the admin token (kept
// in this tab only), overview of the published campaigns with live totals, the donations ledger (filters, status,
// receipts, manual entries), donor wall moderation, recurring donors, CSV / JSON export, crypto scan and the provider
// settings (secrets are write-only: the server never sends them back). Without a backend the page says so.
import './admin-i18n.js';
import { h, $ } from '../ui/dom.js';
import { t, toast, startApp, button, card, field, textInput, select, toggle } from '../ui/app.js';
import { iconEl } from '../ui/icons.js';
import { downloadBlob } from '../ui/files.js';
import { openDialog } from '../ui/overlays.js';
import { httpFetch } from './net.js';

//
// Token handling: sessionStorage (this tab only, cleared when it closes) rather than localStorage - a forgotten tab is
// the longest a token lives in the browser, and other tabs/windows never see it. Sent as a Bearer header (never a
// cookie), so no CSRF exposure. Any 401 wipes it and returns to the sign-in form.
// The API base resolves 'api/' against document.baseURI, so the console works under any mount prefix.
const KEY = 'fd-admin-token';
const apiBase = () => new URL('api/', document.baseURI).href;
const S = { token: '', tab: 'overview', data: {}, filter: { status: '', method: '', q: '', site: '' } };
const getTok = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const setTok = (v) => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* blocked */ } };

// One wrapper for all admin requests: cache:'no-store' (ledger data must be fresh and not cached), JSON body only
// when given, server error messages surfaced as Error text, blob mode for exports.
async function call(path, o = {}) {
  const r = await httpFetch(apiBase() + 'admin/' + path, {
    method: o.method || 'GET', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + S.token, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  if (r.status === 401) { setTok(''); S.token = ''; render(); throw new Error(t('ad.unauthorized')); }
  if (o.blob) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}

const money = (n, cur) => { try { return new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n); } catch { return n + ' ' + cur; } };
const when = (s) => { try { return new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)); } catch { return s; } };
const main = () => $('#main');

// Is a funding backend behind this page? (admin.html opened from a static host or file:// shows a notice instead.)
async function probe() {
  try { const r = await httpFetch(apiBase() + 'info', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; return !!(j && j.app === 'funding-studio'); } catch { return false; }
}

// The token is validated by an actual request (overview) before being stored; autocomplete=current-password lets a
// password manager offer to save it.
function login() {
  const tok = textInput('', () => {}, { type: 'password', autocomplete: 'current-password' });
  const go = async () => {
    S.token = tok.value.trim();
    try { await call('overview'); setTok(S.token); render(); } catch (e) { S.token = ''; toast(e.message, 'error'); }
  };
  tok.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  main().append(card('ad.signIn', h('p', { class: 'ed-hint' }, t('ad.signInHint')), field('ad.token', tok), button('ad.signInBtn', 'lock', go, 'primary')));
}

function tabs() {
  const list = [['overview', 'ad.t.overview', 'chart'], ['donations', 'ad.t.donations', 'list'], ['wall', 'ad.t.wall', 'users'], ['recurring', 'ad.t.recurring', 'refresh'], ['settings', 'ad.t.settings', 'settings']];
  return h('nav', { class: 'fa-tabs', role: 'tablist' }, list.map(([k, l, ic]) => h('button', {
    type: 'button', role: 'tab', class: 'fa-tab' + (S.tab === k ? ' ed-on' : ''), 'aria-selected': String(S.tab === k), onclick: () => { S.tab = k; render(); },
  }, iconEl(ic), t(l))), h('span', { class: 'ed-spacer' }), button('ad.signOut', 'unlock', () => { setTok(''); S.token = ''; render(); }));
}

async function overview(box) {
  const o = await call('overview');
  S.data.overview = o;
  const stats = h('div', { class: 'fa-stats' }, [['ad.succeeded', o.counts.succeeded], ['ad.pending', o.counts.pending], ['ad.wallQueue', o.counts.wall], ['ad.activeRecurring', o.counts.recurring]]
    .map(([k, v]) => h('div', { class: 'fa-stat' }, h('strong', {}, String(v)), h('span', {}, t(k)))));
  box.append(stats);
  if (!o.sites.length) box.append(card('ad.sites', h('p', { class: 'ed-hint' }, t('ad.noSites'))));
  for (const s of o.sites) {
    box.append(card('=' + s.name, h('p', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.url)),
      h('div', { class: 'fa-camps' }, s.campaigns.map((c) => {
        const pct = c.goal ? Math.min(100, (c.raised / c.goal) * 100) : 0;
        return h('div', { class: 'fa-camp' }, h('strong', {}, c.title), h('div', { class: 'fa-bar' }, h('span', { style: { width: pct + '%' } })),
          h('small', {}, `${money(c.raised, c.currency)} / ${money(c.goal, c.currency)} · ${t('ad.donorsN', { n: c.donors })}`));
      }))));
  }
  const prov = h('ul', { class: 'fa-prov' }, Object.entries(o.providers).map(([k, v]) => h('li', { class: v ? 'ed-on' : '' }, iconEl(v ? 'check' : 'minus'), t('ad.p.' + k))));
  box.append(card('ad.providers', prov, h('p', { class: 'ed-hint' }, t('ad.webhooksHint')),
    h('dl', { class: 'fa-dl' }, Object.entries(o.endpoints).flatMap(([k, u]) => [h('dt', {}, t('ad.p.' + k)), h('dd', { class: 'ed-mono' }, u)]))));
  box.append(h('div', { class: 'fa-row' },
    button('ad.scan', 'refresh', async () => { try { const r = await call('scan', { method: 'POST', body: {} }); toast(t('ad.scanned', { n: (r.btc || 0) + (r.eth || 0) + (r.tbc || 0) }), 'ok'); render(); } catch (e) { toast(e.message, 'error'); } }),
    button('ad.exportCsv', 'download', () => exportFile('export.csv', 'csv')), button('ad.exportJson', 'download', () => exportFile('export.json', 'json'))));
}

async function exportFile(p, ext) {
  try { const b = await call(p, { blob: true }); downloadBlob(b, 'donations-' + new Date().toISOString().slice(0, 10) + '.' + ext); } catch (e) { toast(e.message, 'error'); }
}

function statusTag(s) { return h('span', { class: 'fa-tag fa-st-' + s }, t('ad.st.' + s)); }

// Ledger table (also the wall moderation queue with wallOnly). Donor-written text (name, message) is inserted as text
// by h(), never as HTML - the console is the most privileged page and the most attractive XSS target.
// "Mark paid" is offered only for methods without automatic confirmation (bank, crypto fallback, other); card
// payments change state only through provider confirmation. The search applies on 'change' (Enter/blur), not per key.
async function donations(box, wallOnly) {
  const f = S.filter;
  const qs = new URLSearchParams();
  if (wallOnly) qs.set('wall', 'pending'); else { for (const k of ['status', 'method', 'q']) if (f[k]) qs.set(k, f[k]); }
  qs.set('limit', '200');
  const r = await call('donations?' + qs);
  if (!wallOnly) {
    const q = textInput(f.q, (v) => { f.q = v; }, { placeholder: t('ad.search'), type: 'search' });
    q.addEventListener('change', () => render());
    const st = select([{ v: '', l: 'ad.all' }, ...['succeeded', 'pending', 'created', 'failed', 'expired', 'refunded', 'cancelled'].map((v) => ({ v, l: 'ad.st.' + v }))], f.status, (v) => { f.status = v; render(); });
    const me = select([{ v: '', l: 'ad.all' }, ...['stripe', 'paypal', 'tbc', 'btc', 'eth', 'bank', 'cash', 'other'].map((v) => ({ v, l: 'ad.m.' + v }))], f.method, (v) => { f.method = v; render(); });
    box.append(h('div', { class: 'fa-row fa-filters' }, q, st, me, button('ad.addManual', 'plus', () => manual()), h('span', { class: 'ed-spacer' }), h('span', { class: 'ed-muted' }, t('ad.total', { n: r.total }))));
  } else box.append(h('p', { class: 'ed-hint' }, t('ad.wallHint')));
  if (!r.items.length) { box.append(h('p', { class: 'ed-muted' }, t(wallOnly ? 'ad.wallEmpty' : 'ad.none'))); return; }
  const rows = r.items.map((d) => {
    const acts = h('div', { class: 'fa-acts' });
    if (d.donor && d.donor.wall && d.status === 'succeeded') {
      if (d.wall !== 'approved') acts.append(button('ad.approve', 'check', () => patch(d.id, { wall: 'approved' }), wallOnly ? 'primary' : ''));
      if (d.wall !== 'hidden') acts.append(button('ad.hide', 'eyeOff', () => patch(d.id, { wall: 'hidden' })));
    }
    if (!wallOnly && (d.status === 'pending' || d.status === 'created') && ['bank', 'btc', 'eth', 'other'].includes(d.method)) acts.append(button('ad.markPaid', 'check', () => patch(d.id, { status: 'succeeded' })));
    if (!wallOnly && d.status === 'succeeded') acts.append(button('ad.markRefunded', 'undo', () => patch(d.id, { status: 'refunded' })));
    if (d.receiptURL) acts.append(h('a', { class: 'ed-btn', href: d.receiptURL, target: '_blank', rel: 'noopener' }, iconEl('file'), t('ad.receipt')));
    const who = d.donor && d.donor.name ? d.donor.name + (d.donor.anon ? ' · ' + t('ad.anon') : '') : t('ad.anon');
    return h('tr', {},
      h('td', {}, when(d.created), d.test ? h('span', { class: 'fa-tag' }, t('ad.testMode')) : null),
      h('td', {}, h('strong', {}, money(d.amount, d.currency)), d.interval === 'month' ? h('small', {}, ' · ' + t('ad.monthly')) : null, d.renewal ? h('small', {}, ' · ' + t('ad.renewal')) : null),
      h('td', {}, t('ad.m.' + d.method)), h('td', {}, statusTag(d.status)),
      h('td', {}, who, d.donor && d.donor.email ? h('div', { class: 'ed-muted' }, d.donor.email) : null, d.donor && d.donor.message ? h('div', { class: 'fa-msg' }, '“' + d.donor.message + '”') : null),
      h('td', {}, d.donor && d.donor.wall ? t('ad.wall.' + d.wall) : '—'), h('td', {}, acts));
  });
  box.append(h('div', { class: 'fa-table-wrap' }, h('table', { class: 'fa-table' },
    h('thead', {}, h('tr', {}, ['ad.c.date', 'ad.c.amount', 'ad.c.method', 'ad.c.status', 'ad.c.donor', 'ad.c.wall', 'ad.c.actions'].map((k) => h('th', { scope: 'col' }, t(k))))),
    h('tbody', {}, rows))));
}

async function patch(id, body) {
  try { await call('donations/' + id, { method: 'PATCH', body }); toast(t('ad.saved'), 'ok'); render(); } catch (e) { toast(e.message, 'error'); }
}

async function manual() {
  const o = S.data.overview || await call('overview');
  const camps = o.sites.flatMap((s) => s.campaigns.map((c) => ({ v: s.id + '|' + c.id, l: '=' + s.name + ' · ' + c.title, cur: c.currency })));
  if (!camps.length) { toast(t('ad.noSites'), 'warn'); return; }
  const v = { camp: camps[0].v, amount: '', currency: camps[0].cur, method: 'bank', name: '', email: '', wall: false };
  const body = h('div', { class: 'ed-fields' },
    field('ad.c.campaign', select(camps, v.camp, (x) => { v.camp = x; })),
    field('ad.c.amount', textInput('', (x) => { v.amount = x; }, { inputmode: 'decimal' })),
    field('ad.currency', textInput(v.currency, (x) => { v.currency = x.toUpperCase(); }, { maxlength: 3 })),
    field('ad.c.method', select(['bank', 'cash', 'other'].map((m) => ({ v: m, l: 'ad.m.' + m })), v.method, (x) => { v.method = x; })),
    field('ad.name', textInput('', (x) => { v.name = x; })), field('ad.email', textInput('', (x) => { v.email = x; }, { type: 'email' })),
    field('ad.showOnWall', toggle(false, (x) => { v.wall = x; })));
  const ok = await openDialog({ title: t('ad.addManual'), body, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('ad.add'), value: 'ok', primary: true }] });
  if (ok !== 'ok') return;
  const [site, campaign] = v.camp.split('|');
  try {
    await call('donations', { method: 'POST', body: { site, campaign, amount: Number(String(v.amount).replace(',', '.')), currency: v.currency, method: v.method, donor: { name: v.name, email: v.email, wall: v.wall } } });
    toast(t('ad.saved'), 'ok');
    render();
  } catch (e) { toast(e.message, 'error'); }
}

async function recurring(box) {
  const list = await call('recurring');
  if (!list.length) { box.append(h('p', { class: 'ed-muted' }, t('ad.noRecurring'))); return; }
  box.append(h('div', { class: 'fa-table-wrap' }, h('table', { class: 'fa-table' },
    h('thead', {}, h('tr', {}, ['ad.c.date', 'ad.c.amount', 'ad.c.method', 'ad.c.status', 'ad.c.donor', 'ad.payments'].map((k) => h('th', { scope: 'col' }, t(k))))),
    h('tbody', {}, list.map((s) => h('tr', {}, h('td', {}, when(s.created)), h('td', {}, money(s.amount, s.currency) + ' / ' + t('ad.month')), h('td', {}, t('ad.m.' + s.provider)),
      h('td', {}, h('span', { class: 'fa-tag fa-st-' + (s.status === 'active' ? 'succeeded' : 'cancelled') }, t('ad.sub.' + s.status))),
      h('td', {}, (s.donor && s.donor.name) || t('ad.anon'), s.donor && s.donor.email ? h('div', { class: 'ed-muted' }, s.donor.email) : null), h('td', {}, String((s.payments || 0) + 1))))))));
}

// Settings form over a deep copy of the masked settings. Secret inputs start empty (placeholder says whether one is
// set); an empty value means "keep", the remove toggle adds the path to `clear`. Multi-line fields (origins, BTC
// addresses, RPC per chain id, fixed rates 'BTC EUR 60000') are parsed line by line; unparsable lines are dropped,
// and the server normalises everything again.
async function settings(box) {
  const st = await call('settings');
  const v = JSON.parse(JSON.stringify(st));
  const clear = new Set();
  const txt = (obj, k, attrs = {}) => textInput(obj[k] ?? '', (x) => { obj[k] = x; }, attrs);
  const secret = (sec, k) => {
    const set = st.secretsSet[sec + '.' + k];
    const i = textInput('', (x) => { v[sec][k] = x; }, { type: 'password', autocomplete: 'off', placeholder: set ? t('ad.secretSet') : t('ad.secretEmpty') });
    const rm = set ? h('label', { class: 'fa-clear' }, toggle(false, (on) => { if (on) clear.add(sec + '.' + k); else clear.delete(sec + '.' + k); }), t('ad.remove')) : null;
    return h('div', { class: 'fa-secret' }, i, rm);
  };
  box.append(h('p', { class: 'ed-hint' }, t('ad.settingsHint')));
  box.append(card('ad.general',
    field('ad.publicURL', txt(v, 'publicURL', { placeholder: 'https://donate.example.org/' }), 'ad.publicURLH'),
    field('ad.origins', textInput((v.origins || []).join('\n'), (x) => { v.origins = x.split(/\s+/).filter(Boolean); }, { multiline: true, rows: 2 }), 'ad.originsH'),
    field('ad.wallMode', select([{ v: 'review', l: 'ad.wall.review' }, { v: 'auto', l: 'ad.wall.auto' }], v.wall, (x) => { v.wall = x; })),
    field('ad.receiptPrefix', txt(v.receipts, 'prefix', { maxlength: 12 }))));
  box.append(card('=Stripe', field('ad.stripeKey', secret('stripe', 'secretKey'), 'ad.stripeKeyH'), field('ad.stripeWh', secret('stripe', 'webhookSecret'), 'ad.stripeWhH'),
    field('ad.apiBase', txt(v.stripe, 'api', { placeholder: 'https://api.stripe.com' }), 'ad.apiBaseH'), test('stripe')));
  box.append(card('=PayPal', field('ad.ppClient', txt(v.paypal, 'clientId')), field('ad.ppSecret', secret('paypal', 'secret')), field('ad.ppWebhook', txt(v.paypal, 'webhookId'), 'ad.ppWebhookH'),
    field('ad.sandbox', toggle(v.paypal.sandbox, (x) => { v.paypal.sandbox = x; })), field('ad.apiBase', txt(v.paypal, 'api'), 'ad.apiBaseH'), test('paypal')));
  box.append(card('=TBC Bank', field('ad.tbcKey', secret('tbc', 'apiKey'), 'ad.tbcKeyH'), field('ad.tbcClient', txt(v.tbc, 'clientId')), field('ad.tbcSecret', secret('tbc', 'clientSecret')),
    field('ad.apiBase', txt(v.tbc, 'api', { placeholder: 'https://api.tbcbank.ge' }), 'ad.apiBaseH'), test('tbc')));
  box.append(card('=Bitcoin', field('ad.esplora', txt(v.btc, 'esplora', { placeholder: 'https://…/api' }), 'ad.esploraH'),
    field('ad.btcAddresses', textInput((v.btc.addresses || []).join('\n'), (x) => { v.btc.addresses = x.split(/\s+/).filter(Boolean); }, { multiline: true, rows: 4 }), 'ad.btcAddressesH'),
    field('ad.xpub', txt(v.btc, 'xpub'), 'ad.xpubH'), field('ad.confirmations', txt(v.btc, 'confirmations', { type: 'number', min: 0, max: 12 }))));
  const rpcText = Object.entries(v.eth.rpc || {}).map(([k, u]) => k + ' ' + u).join('\n');
  box.append(card('=Ethereum', field('ad.rpc', textInput(rpcText, (x) => { const o = {}; for (const l of x.split('\n')) { const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(l); if (m) o[m[1]] = m[2]; } v.eth.rpc = o; }, { multiline: true, rows: 3 }), 'ad.rpcH'),
    field('ad.confirmations', txt(v.eth, 'confirmations', { type: 'number', min: 1, max: 64 }))));
  const ratesText = Object.entries(v.rates || {}).map(([k, x]) => k.replace(':', ' ') + ' ' + x).join('\n');
  box.append(card('ad.rates', field('ad.ratesFixed', textInput(ratesText, (x) => { const o = {}; for (const l of x.split('\n')) { const m = /^\s*([A-Za-z]{3,5})\s*[:/ ]\s*([A-Za-z]{3})\s+([\d.]+)\s*$/.exec(l); if (m) o[m[1].toUpperCase() + ':' + m[2].toUpperCase()] = Number(m[3]); } v.rates = o; }, { multiline: true, rows: 3 }), 'ad.ratesFixedH'),
    field('ad.priceURL', txt(v.price, 'url', { placeholder: 'https://' }))));
  box.append(h('div', { class: 'fa-row fa-sticky' }, button('ad.saveSettings', 'save', async () => {
    try { await call('settings', { method: 'PUT', body: { ...v, clear: [...clear] } }); toast(t('ad.saved'), 'ok'); render(); } catch (e) { toast(e.message, 'error'); }
  }, 'primary')));
}

function test(p) {
  return button('ad.test', 'zap', async () => {
    try { const r = await call('test/' + p, { method: 'POST', body: {} }); toast(r.ok ? t('ad.testOk') : t('ad.testFail', { msg: r.error }), r.ok ? 'ok' : 'error'); } catch (e) { toast(e.message, 'error'); }
  });
}

// Render generation counter: each render takes a number, and async steps check it before writing, so a slow
// response from an earlier tab cannot paint over the tab the admin switched to.
let seq = 0;
async function render() {
  const my = ++seq;
  const m = main();
  m.textContent = '';
  if (!(await probe())) { if (my === seq) m.append(card('ad.noBackend', h('p', {}, t('ad.noBackendText')))); return; }
  if (my !== seq) return;
  if (!S.token) { login(); return; }
  m.append(tabs());
  const box = h('div', { class: 'fa-body' });
  m.append(box);
  try {
    if (S.tab === 'overview') await overview(box);
    else if (S.tab === 'donations') await donations(box, false);
    else if (S.tab === 'wall') await donations(box, true);
    else if (S.tab === 'recurring') await recurring(box);
    else await settings(box);
  } catch (e) { if (my === seq) box.append(h('p', { class: 'ed-error' }, e.message)); }
}

S.token = getTok();
startApp({
  key: 'fd-admin', name: 'ad.name', logo: 'M12 13.5s-5-3-6.2-6.3C5 4.9 6.6 3 8.7 3c1.4 0 2.6.8 3.3 1.9C12.7 3.8 13.9 3 15.3 3c2.1 0 3.7 1.9 2.9 4.2C17 10.5 12 13.5 12 13.5zM4 21h16M6 21v-3M10 21v-5M14 21v-4M18 21v-6',
  pages: [{ href: 'index.html', label: 'ad.studio' }, { href: 'admin.html', label: 'ad.console', current: true }],
  onLang: () => render(),
});
render();
// Test hook for e2e-backend.js (drives the console from the page). Exposes nothing a signed-in page script could not
// already do with the token in sessionStorage.
window.__fdAdmin = { S, render, call };
