// funding-studio/backend.js - the backend of the BACKEND artifact (hosting.js mounts it; the development server
// `node funding-studio/server.js` too): published campaign sites, provider keys kept on the server only, checkouts
// (Stripe Checkout Sessions, PayPal Orders v2 / Subscriptions, TBC E-Commerce), webhooks and callbacks, the donations
// ledger with live goal progress, donor wall moderation, recurring donors, receipts, CSV / JSON export, crypto
// detection (Esplora, JSON-RPC). Contract: default export (ctx) => ({ handle(req, res, url) }), ctx = { dataDir,
// storage: { read, write, list, remove }, log, name, node: { http, https, dns, net, zlib } }.
//
// Public API below the application's base (<base>api/…, JSON, CORS for any origin, no cookies):
//   GET  api/info                                 { app: 'funding-studio', version }
//   GET  api/sites/<site>/live                    { ok, methods, currencies, camps: { <id>: { raised, donors, wall } } }
//   POST api/checkout                             { site, campaign, method, amount, currency, interval, donor, lang, back, thanks }
//                                                 -> { url, id, key }   (stripe | paypal | tbc)
//   POST api/btc/address                          same body -> { id, key, address, btc, uri }
//   POST api/eth/claim                            { site, campaign, chain, token, tx, from, amount, currency, donor } -> { id, key }
//   GET  api/donations/<id>?k=<key>               { id, status, amount, currency, method, interval, receipt, manage }
//   GET  api/receipts/<id>?k=<key>[&download=1]   receipt (HTML)
//   POST api/portal                               { id, key } -> { url } | { cancelled: true }
//   GET  api/return/paypal | api/return/tbc       provider returns (302 to the thank-you page)
//   POST api/webhooks/stripe | api/webhooks/paypal | api/callbacks/tbc
// Admin API (Authorization: Bearer <token>: env FS_ADMIN_TOKEN, else generated on first start and printed):
//   GET api/admin/overview · GET/PUT api/admin/settings · GET api/admin/sites · PUT/DELETE api/admin/sites/<id>
//   GET api/admin/donations?site&campaign&status&method&q&wall&offset&limit · POST api/admin/donations (manual entry)
//   PATCH api/admin/donations/<id> { wall, status, note } · GET api/admin/recurring · GET api/admin/export.csv|json
//   POST api/admin/scan · POST api/admin/test/<stripe|paypal|tbc> · GET api/admin/receipts/<id>
// Pages: <base>s/<site slug>/ (home campaign), <base>s/<site slug>/<page>/ - rendered with the editor's engine, with
// live figures, talking to the API above and falling back to the methods without a server when it is unreachable.
// Storage keys: admin-token, settings, site:<id>, don:<id>, sub:<id>, receipt-seq, paypal-plans, btc-index, seen-events.
//
// Security model (the reasons behind most code below):
// - The browser is never trusted with amounts or status. A page only *requests* a checkout; the amount, currency and
//   method are re-validated against the published document (donationInput), and a donation becomes 'succeeded' only
//   from a provider-verified source: a signed webhook, a server-side API read (refreshStripe, tbcUpdate, PayPal
//   capture) or an on-chain check. Return URLs from providers are treated as "go look", never as proof.
// - Each donation has a random `key`; donor-facing reads (status, receipt, portal) require it, compared in constant
//   time, so donation ids alone (sequential-looking, visible in URLs) reveal nothing.
// - Secrets live only here; the console gets them masked and can only overwrite or clear them.
// - Redirect targets (thanks/back) must be on this server's origin or an owner-listed origin (no open redirect).
// - Every body is size-capped, every public endpoint rate-limited per socket IP, payment endpoints more strictly.
// - Webhook event ids are remembered (last 3000) so a replayed or retried event is applied once.
import { nodeRequester } from '../payments/http.js';
import { PAYPAL_CURRENCIES, TBC_CURRENCIES, isCurrency } from '../payments/money.js';
import { htmlToText, pickText } from '../i18n/text.js';
import { buildSite } from './site.js';
import { normalizeDoc, pageById, slugFromTitle, normSlug, livePages, VERSION, normRates } from './viewer.js';
import { createLedger, FINAL } from './server-ledger.js';
import { CORS, bearer, clientIP, emailOK, json, line, originOf, publicBase, randomId, rateLimiter, readBody, readJSON, redirect, sameSecret, send, toCSV } from './server-util.js';
import { createCheckout, manageRecurring, paypalOf, paypalWebhook, refreshStripe, returnPaypal, returnTbc, stripeOf, stripeWebhook, tbcCallback, tbcOf, tbcTick, tbcUpdate, testProvider } from './server-pay.js';
import { assignBtc, btcReady, btcScan, btcUnits, ethReady, ethScan, ethVerify, priceOf } from './server-crypto.js';
import { bip21, btcAddressInfo, btcAmount, derivationSpecProblem, EVM_CHAINS, tokenInfo, wireCrypto } from './chains.js';
import { deriveAddress } from '../bitcoin/account.js';
import { receiptHTML } from './server-receipt.js';

const SECRET_PATHS = ['stripe.secretKey', 'stripe.webhookSecret', 'paypal.secret', 'tbc.apiKey', 'tbc.clientSecret'];

export const DEFAULT_SETTINGS = () => ({
  publicURL: '', origins: [], wall: 'review', pollSeconds: 120, receipts: { prefix: 'R' },
  stripe: { secretKey: '', webhookSecret: '', api: '' },
  paypal: { clientId: '', secret: '', webhookId: '', sandbox: true, api: '' },
  tbc: { apiKey: '', clientId: '', clientSecret: '', api: '', methods: [] },
  btc: { esplora: '', addresses: [], xpub: '', network: 'main', confirmations: 1 },
  eth: { rpc: {}, confirmations: 2 },
  rates: {}, price: { url: '', paths: { BTC: '', ETH: '', USD: '' } },
});

const s = (v, n = 500) => line(v, n);
const urlOrEmpty = (v) => { const x = s(v, 2000); return /^https?:\/\/[^\s]+$/.test(x) ? x.replace(/\/+$/, '') : ''; };

// Normalise a (partial) settings update over the previous settings: per field, the new value if present, else the
// previous, else the default (g()). Every string is single-lined and capped, URLs must be http(s) (no javascript: or
// file: that a later fetch or redirect could follow), lists are deduplicated and capped, numbers clamped (poll 30 s ..
// 1 h; BTC confirmations 0..12; ETH 1..64). Invalid Bitcoin addresses are dropped silently rather than rejected,
// so a pasted list with one typo still saves the rest. PayPal defaults to sandbox unless explicitly false.
export function normSettings(src, prev = DEFAULT_SETTINGS()) {
  const o = src && typeof src === 'object' ? src : {};
  const d = DEFAULT_SETTINGS();
  const g = (sec, k) => (o[sec] && o[sec][k] !== undefined ? o[sec][k] : prev[sec] && prev[sec][k] !== undefined ? prev[sec][k] : d[sec][k]);
  const rpc = {};
  const rsrc = (o.eth && o.eth.rpc) || prev.eth.rpc || {};
  for (const [k, v] of Object.entries(rsrc)) if (EVM_CHAINS[k] && urlOrEmpty(v)) rpc[k] = urlOrEmpty(v);
  const addrs = (Array.isArray(g('btc', 'addresses')) ? g('btc', 'addresses') : String(g('btc', 'addresses') || '').split(/[\s,;]+/)).map((x) => s(x, 100)).filter((x) => btcAddressInfo(x).ok);
  const pub = o.publicURL !== undefined ? o.publicURL : prev.publicURL;
  return {
    publicURL: urlOrEmpty(pub) ? urlOrEmpty(pub) + '/' : '',
    origins: (Array.isArray(o.origins) ? o.origins : o.origins !== undefined ? String(o.origins).split(/[\s,]+/) : prev.origins).map(originOf).filter(Boolean).slice(0, 50),
    wall: ['review', 'auto'].includes(o.wall) ? o.wall : prev.wall || 'review',
    pollSeconds: Math.max(30, Math.min(3600, Number(o.pollSeconds ?? prev.pollSeconds) || 120)),
    receipts: { prefix: s((o.receipts && o.receipts.prefix) ?? prev.receipts.prefix, 12).replace(/[^A-Za-z0-9-]/g, '') || 'R' },
    stripe: { secretKey: s(g('stripe', 'secretKey'), 300), webhookSecret: s(g('stripe', 'webhookSecret'), 300), api: urlOrEmpty(g('stripe', 'api')) },
    paypal: { clientId: s(g('paypal', 'clientId'), 300), secret: s(g('paypal', 'secret'), 300), webhookId: s(g('paypal', 'webhookId'), 100), sandbox: g('paypal', 'sandbox') !== false, api: urlOrEmpty(g('paypal', 'api')) },
    tbc: { apiKey: s(g('tbc', 'apiKey'), 300), clientId: s(g('tbc', 'clientId'), 300), clientSecret: s(g('tbc', 'clientSecret'), 300), api: urlOrEmpty(g('tbc', 'api')),
      methods: (Array.isArray(g('tbc', 'methods')) ? g('tbc', 'methods') : []).map(Number).filter((m) => [4, 5, 7, 8].includes(m)) },
    btc: { esplora: urlOrEmpty(g('btc', 'esplora')), addresses: [...new Set(addrs)].slice(0, 2000), xpub: s(g('btc', 'xpub'), 400), network: g('btc', 'network') === 'test' ? 'test' : 'main', confirmations: Math.max(0, Math.min(12, Number(g('btc', 'confirmations')) || 1)) },
    eth: { rpc, confirmations: Math.max(1, Math.min(64, Number(o.eth && o.eth.confirmations !== undefined ? o.eth.confirmations : prev.eth.confirmations) || 2)) },
    rates: normRates({ fixed: o.rates !== undefined ? o.rates : prev.rates }).fixed,
    price: (() => { const p = o.price || prev.price || {}; const r = normRates({ url: p.url, paths: p.paths }); return { url: r.url, paths: r.paths }; })(),
  };
}

// Settings for the console: secrets replaced by a mark (never sent back to a browser).
// The last 4 characters are shown so the owner can tell which key is installed without exposing it; secretsSet tells
// the UI which fields have a value. PUT treats a value starting with the mark as "unchanged".
function maskSettings(st) {
  const out = JSON.parse(JSON.stringify(st));
  const set = {};
  for (const p of SECRET_PATHS) {
    const [a, b] = p.split('.');
    set[p] = !!out[a][b];
    out[a][b] = out[a][b] ? '••••' + String(st[a][b]).slice(-4) : '';
  }
  out.secretsSet = set;
  return out;
}

export default function backend(ctx) {
  const { storage, log } = ctx;
  const env = (globalThis.process && process.env) || {};
  // Per-donation Bitcoin addresses from the owner's xpub / descriptor (watch-only; no private key ever reaches here).
  wireCrypto({ bitcoin: { deriveAddress } });
  // Admin token: env var wins (deployments), else persisted, else generated once with an alphabet that drops look-alike
  // characters (0/O, 1/l/I) because it is copied by hand from the log. 32 chars of 56 symbols ~ 185 bits.
  let token = env.FS_ADMIN_TOKEN || storage.read('admin-token');
  if (!token) { token = randomId(32, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'); storage.write('admin-token', token); }
  if (env.FS_ADMIN_TOKEN) log('funding-studio: admin token from FS_ADMIN_TOKEN; console at <base>admin.html');
  else log(`funding-studio: admin token ${token} (stored in the data folder; set FS_ADMIN_TOKEN to choose one); console at <base>admin.html`);
  let settings = normSettings(storage.read('settings') || {});
  const ledger = createLedger(storage, log);
  const sites = new Map(); // id -> { id, slug, doc, rev, published }
  for (const k of storage.list('site:')) { const v = storage.read(k); if (v && v.id && v.doc) sites.set(v.id, { ...v, doc: normalizeDoc(v.doc) }); }
  const cache = new Map(); // site id -> { rev, lrev, at, files: Map(path -> html) }
  const request = ctx.node ? nodeRequester(ctx.node) : null;
  const seenList = storage.read('seen-events') || [];
  const seenSet = new Set(seenList);
  // Rate limits per IP: 20 payment creations/min (each costs a provider API call or burns a BTC address), 600 reads/min
  // (live figures are polled by every open page), 20 failed admin logins per 10 min.
  const limitPay = rateLimiter(20, 60000);
  const limitRead = rateLimiter(600, 60000);
  const limitAuth = rateLimiter(20, 600000);

  const B = {
    storage, log, ledger, request,
    settings: () => settings,
    rates: (site) => ({ ...(sites.get(site) ? sites.get(site).doc.pay.rates.fixed : {}), ...settings.rates }),
    siteDoc: (site) => (sites.get(site) ? sites.get(site).doc : null),
    receiptPrefix: () => settings.receipts.prefix,
    wallAuto: () => settings.wall === 'auto',
    // Webhook events are handled once: false for a repeated id. Providers retry deliveries (at-least-once), so handlers
    // must be idempotent; this FIFO window of 3000 ids (Set for O(1) lookup, array for eviction order) is persisted so
    // it survives restarts. Settling is additionally guarded by status transitions in the ledger.
    // Note: the whole list is rewritten to storage on every new event - fine at webhook rates.
    seen(id) {
      if (seenSet.has(id)) return false;
      seenSet.add(id);
      seenList.push(id);
      if (seenList.length > 3000) seenSet.delete(seenList.shift());
      storage.write('seen-events', seenList);
      return true;
    },
  };

  const methodsOf = (doc) => ({
    stripe: !!settings.stripe.secretKey, paypal: !!(settings.paypal.clientId && settings.paypal.secret), tbc: !!(settings.tbc.apiKey && settings.tbc.clientId && settings.tbc.clientSecret),
    btc: btcReady(B), eth: ethReady(B, doc),
  });

  /* ---------- sites ---------- */

  function uniqueSiteSlug(base, id) {
    let sl = normSlug(base) || 'site';
    const taken = new Set([...sites.values()].filter((x) => x.id !== id).map((x) => x.slug));
    let c = sl;
    for (let k = 2; taken.has(c); k++) c = sl + '-' + k;
    return c;
  }

  // Rendered pages per site, cached. Invalidated when the site is republished (rev); when only the ledger changed,
  // the cache is reused for up to 30 s - the baked-in totals may lag that long, pages fetch live figures anyway, and a
  // busy campaign would otherwise re-render the whole site on every donation.
  async function siteFiles(site) {
    const c = cache.get(site.id);
    if (c && c.rev === site.rev && (c.lrev === ledger.rev || Date.now() - c.at < 30000)) return c.files;
    const stats = {};
    for (const [cid, v] of Object.entries(ledger.stats(site.id))) stats[cid] = { raised: v.raised, donors: v.donors };
    const r = await buildSite(site.doc, { mode: 'clean', minify: true, api: { base: '../../', site: site.id }, stats });
    const files = new Map(r.files.map((f) => [f.name, f.data]));
    cache.set(site.id, { rev: site.rev, lrev: ledger.rev, at: Date.now(), files, pages: r.pages });
    return files;
  }

  // Publishing normalises the document (normalizeDoc strips unknown/hostile content) and keeps the slug of an
  // existing site, so republishing never breaks shared links.
  function publishSite(id, raw) {
    const doc = normalizeDoc(raw);
    doc.id = id;
    const prev = sites.get(id);
    const slug = prev ? prev.slug : uniqueSiteSlug(slugFromTitle(doc.name) || doc.name, id);
    const site = { id, slug, doc, rev: (prev ? prev.rev : 0) + 1, published: new Date().toISOString() };
    sites.set(id, site);
    storage.write('site:' + id, site);
    cache.delete(id);
    log('published site', id, slug, 'rev', site.rev);
    return site;
  }

  const pageList = (site) => livePages(site.doc).map((p, i) => ({ id: p.id, kind: p.kind, slug: p.slug, url: 's/' + site.slug + '/' + (i === 0 && p.kind === 'campaign' ? '' : p.slug + '/') }));

  /* ---------- helpers ---------- */

  const title = (doc, camp, lang) => htmlToText(pickText(camp.title, lang || doc.defaultLang, doc)) || doc.name;

  // Open-redirect guard for thanks/back URLs: same origin as this server, or listed in settings.origins (pages hosted
  // elsewhere). Without it, a checkout could bounce donors from a trusted payment page to a phishing site.
  // Inherits the publicBase caveat: with no publicURL configured, "own origin" comes from client headers.
  function allowedThanks(req, prefix, u) {
    const o = originOf(u);
    if (!o) return false;
    const own = originOf(publicBase(req, prefix, settings.publicURL));
    return o === own || settings.origins.includes(o);
  }

  function siteThanks(base, site, camp) {
    const ps = livePages(site.doc);
    const th = ps.find((p) => p.kind === 'thanks');
    const home = ps.find((p) => p.kind === 'campaign');
    const target = th || camp;
    return base + 's/' + site.slug + '/' + (home && target.id === home.id ? '' : target.slug + '/');
  }

  // Common checks of a donation request -> { site, camp, donor, amount, currency, interval } or throws { status }.
  // The campaign must exist, be a campaign and be visible; the amount is rounded to cents and bounded (0.50 .. 1e6:
  // below that provider fees exceed the gift and card testers probe with tiny amounts); the currency must be one the
  // campaign accepts. Donor fields are single-lined and capped; wall/anon must be literally true (opt-in).
  function donationInput(b) {
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
    const site = sites.get(String(b.site || ''));
    if (!site) throw Object.assign(new Error('unknown site'), { status: 404 });
    const camp = pageById(site.doc, String(b.campaign || ''));
    if (!camp || camp.kind !== 'campaign' || camp.hidden) throw Object.assign(new Error('unknown campaign'), { status: 404 });
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount >= 0.5 && amount <= 1e6)) throw bad('amount out of range');
    const currency = String(b.currency || camp.currency);
    if (!isCurrency(currency) || ![camp.currency, ...camp.currencies].includes(currency)) throw bad('currency not accepted');
    const interval = b.interval === 'month' ? 'month' : 'once';
    const dn = b.donor && typeof b.donor === 'object' ? b.donor : {};
    const email = line(dn.email, 254);
    if (email && !emailOK(email)) throw bad('bad e-mail');
    const donor = { name: line(dn.name, 80), email, message: line(dn.message, 280), anon: dn.anon === true, wall: dn.wall === true };
    return { site, camp, donor, amount, currency, interval, lang: line(b.lang, 20) };
  }

  const donationView = (d, base) => {
    const sub = d.sub ? ledger.sub(d.sub) : null;
    return {
      id: d.id, status: d.status, amount: d.amount, currency: d.currency, method: d.method, interval: d.interval, created: d.created, paidAt: d.paidAt || null,
      receipt: d.status === 'succeeded' ? base + 'api/receipts/' + d.id + '?k=' + d.key + '&download=1' : null,
      manage: !!(sub && sub.status === 'active'), test: d.test,
    };
  };

  /* ---------- public API ---------- */

  // Public routes. Notes per route:
  // - checkout: the ledger record is created before calling the provider, so even a provider failure leaves an audit
  //   trail ('failed' with the error as note); the client only sees a generic 502 (no provider details leak).
  // - btc/address: one fresh address per donation (derived or from the pool) so payments can be matched to donations
  //   by address; the expected amount is stored in satoshis as a string (BigInt-safe in JSON).
  // - eth/claim: the page claims a tx hash; the claim is keyed by chain+hash (byRef) so the same tx cannot be claimed
  //   twice, and it stays 'pending' until ethVerify reads the receipt from the owner's RPC.
  // - donations/<id>: lazily refreshes non-final Stripe/TBC payments (TBC at most every 4 s) - the thank-you page polls
  //   this, which gives confirmation even if a webhook is late or not configured.
  // - webhooks/callbacks: raw bytes go to the verifier (signatures are over exact bytes); no CORS headers (server-to-
  //   server only).
  async function publicApi(req, res, rest, prefix, url) {
    const base = publicBase(req, prefix, settings.publicURL);
    const ip = clientIP(req);
    const parts = rest.split('/').filter(Boolean);
    const q = url.searchParams;
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (!limitRead(ip)) { json(res, 429, { error: 'too many requests' }, CORS); return; }
    if (parts[0] === 'info' && req.method === 'GET') { json(res, 200, { app: 'funding-studio', version: VERSION }, CORS); return; }
    if (parts[0] === 'sites' && parts[2] === 'live' && req.method === 'GET') {
      const site = sites.get(parts[1]);
      if (!site) { json(res, 404, { error: 'unknown site' }, CORS); return; }
      const st = ledger.stats(site.id);
      const camps = {};
      for (const p of livePages(site.doc)) if (p.kind === 'campaign') camps[p.id] = st[p.id] || { raised: 0, donors: 0, wall: [] };
      json(res, 200, { ok: true, methods: methodsOf(site.doc), currencies: { paypal: PAYPAL_CURRENCIES, tbc: TBC_CURRENCIES }, camps }, CORS);
      return;
    }
    if (parts[0] === 'checkout' && req.method === 'POST') {
      if (!limitPay(ip)) { json(res, 429, { error: 'too many requests' }, CORS); return; }
      const b = await readJSON(req, 32 * 1024);
      const x = donationInput(b);
      const method = String(b.method || '');
      if (!['stripe', 'paypal', 'tbc'].includes(method) || !x.camp.methods.includes(method) || !methodsOf(x.site.doc)[method]) { json(res, 400, { error: 'method not available' }, CORS); return; }
      if (method === 'paypal' && !PAYPAL_CURRENCIES.includes(x.currency)) { json(res, 400, { error: 'currency not accepted by PayPal' }, CORS); return; }
      if (method === 'tbc' && !TBC_CURRENCIES.includes(x.currency)) { json(res, 400, { error: 'currency not accepted by TBC' }, CORS); return; }
      const thanks = typeof b.thanks === 'string' && allowedThanks(req, prefix, b.thanks) ? b.thanks : siteThanks(base, x.site, x.camp);
      const back = typeof b.back === 'string' && allowedThanks(req, prefix, b.back) ? b.back : thanks;
      const d = ledger.create({ site: x.site.id, campaign: x.camp.id, method, interval: x.interval, amount: x.amount, currency: x.currency, campCur: x.camp.currency, donor: x.donor, thanks, back, lang: x.lang });
      try {
        const u = await createCheckout(B, d, base, title(x.site.doc, x.camp, x.lang));
        json(res, 200, { url: u, id: d.id, key: d.key }, CORS);
      } catch (e) {
        ledger.settle(d, { status: 'failed' });
        d.note = e.message;
        ledger.save(d);
        log('checkout failed', method, e.message);
        json(res, 502, { error: 'the payment provider could not be reached' }, CORS);
      }
      return;
    }
    if (parts[0] === 'btc' && parts[1] === 'address' && req.method === 'POST') {
      if (!limitPay(ip)) { json(res, 429, { error: 'too many requests' }, CORS); return; }
      const b = await readJSON(req, 32 * 1024);
      const x = donationInput(b);
      if (!x.camp.methods.includes('btc') || !btcReady(B)) { json(res, 400, { error: 'method not available' }, CORS); return; }
      let address = '';
      try { address = assignBtc(B); } catch (e) { log('btc derive', e.message); }
      if (!address) { json(res, 409, { error: 'no free address' }, CORS); return; }
      const p = await priceOf(B, x.site.id, 'BTC', x.currency);
      const btc = p ? btcAmount(x.amount / p) : '';
      const d = ledger.create({ site: x.site.id, campaign: x.camp.id, method: 'btc', interval: 'once', amount: x.amount, currency: x.currency, campCur: x.camp.currency, donor: x.donor, lang: x.lang,
        thanks: typeof b.thanks === 'string' && allowedThanks(req, prefix, b.thanks) ? b.thanks : siteThanks(base, x.site, x.camp), data: { btc: { address, expect: btc ? btcUnits(btc).toString() : null } } });
      const label = (x.site.doc.pay.btc.label || title(x.site.doc, x.camp, x.lang)).slice(0, 60);
      json(res, 200, { id: d.id, key: d.key, address, btc, uri: bip21({ address, amount: btc || null, label }) }, CORS);
      return;
    }
    if (parts[0] === 'eth' && parts[1] === 'claim' && req.method === 'POST') {
      if (!limitPay(ip)) { json(res, 429, { error: 'too many requests' }, CORS); return; }
      const b = await readJSON(req, 32 * 1024);
      const x = donationInput(b);
      const tx = String(b.tx || '');
      const chain = Number(b.chain);
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx) || !x.site.doc.pay.eth.chains.includes(chain) || !tokenInfo(chain, String(b.token || ''), x.site.doc.pay.eth.custom)) { json(res, 400, { error: 'bad claim' }, CORS); return; }
      const ref = 'eth:tx:' + chain + ':' + tx.toLowerCase();
      let d = ledger.byRef(ref);
      if (!d) {
        d = ledger.create({ site: x.site.id, campaign: x.camp.id, method: 'eth', interval: 'once', amount: x.amount, currency: x.currency, campCur: x.camp.currency, donor: x.donor, lang: x.lang,
          thanks: siteThanks(base, x.site, x.camp), status: 'pending', data: { eth: { chain, tx: tx.toLowerCase(), token: String(b.token), from: line(b.from, 42) } } });
        ledger.addRef(d, ref);
        ledger.save(d);
        ethVerify(B, d).catch((e) => log('eth verify', d.id, e.message));
      }
      json(res, 200, { id: d.id, key: d.key }, CORS);
      return;
    }
    if (parts[0] === 'donations' && parts[1] && req.method === 'GET') {
      const d = ledger.get(parts[1]);
      if (!d || !sameSecret(q.get('k'), d.key)) { json(res, 404, { error: 'not found' }, CORS); return; }
      if (d.method === 'stripe' && !FINAL.includes(d.status)) await refreshStripe(B, d);
      if (d.method === 'tbc' && d.status === 'pending' && Date.now() - (d._checked || 0) > 4000) { d._checked = Date.now(); try { await tbcUpdate(B, d); } catch { /* keep */ } }
      json(res, 200, donationView(d, base), CORS);
      return;
    }
    if (parts[0] === 'receipts' && parts[1] && req.method === 'GET') {
      const d = ledger.get(parts[1]);
      if (!d || !sameSecret(q.get('k'), d.key) || d.status !== 'succeeded') { json(res, 404, { error: 'not found' }, CORS); return; }
      receipt(res, d, q.get('download') === '1');
      return;
    }
    if (parts[0] === 'portal' && req.method === 'POST') {
      const b = await readJSON(req, 4096);
      const d = ledger.get(String(b.id || ''));
      if (!d || !sameSecret(b.key, d.key)) { json(res, 404, { error: 'not found' }, CORS); return; }
      try { json(res, 200, await manageRecurring(B, d, base), CORS); } catch (e) { json(res, e.status || 502, { error: e.message }, CORS); }
      return;
    }
    if (parts[0] === 'return' && req.method === 'GET') {
      const d = ledger.get(String(q.get('d') || ''));
      if (!d || !sameSecret(q.get('k'), d.key)) { json(res, 404, { error: 'not found' }); return; }
      if (parts[1] === 'paypal') { redirect(res, await returnPaypal(B, d, q)); return; }
      if (parts[1] === 'tbc') { redirect(res, await returnTbc(B, d)); return; }
    }
    if (parts[0] === 'webhooks' && req.method === 'POST') {
      const raw = await readBody(req, 512 * 1024);
      const r = parts[1] === 'stripe' ? await stripeWebhook(B, raw, req.headers) : parts[1] === 'paypal' ? await paypalWebhook(B, raw, req.headers) : { status: 404, body: { error: 'not found' } };
      json(res, r.status, r.body);
      return;
    }
    if (parts[0] === 'callbacks' && parts[1] === 'tbc' && req.method === 'POST') {
      const raw = await readBody(req, 64 * 1024);
      const r = await tbcCallback(B, raw, req.headers);
      json(res, r.status, r.body);
      return;
    }
    json(res, 404, { error: 'not found' }, CORS);
  }

  // Receipt with a strict CSP: nothing may load (default-src 'none'); only its own inline style and the inline print
  // script run. Donor-provided text inside is escaped by receiptHTML, and the CSP is a second wall. The download file
  // name is reduced to [\w-] so a receipt number cannot inject header syntax.
  function receipt(res, d, download) {
    const site = sites.get(d.site);
    const camp = site ? pageById(site.doc, d.campaign) : null;
    send(res, 200, receiptHTML(d, site ? site.doc : null, camp), 'text/html; charset=utf-8',
      { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", ...(download ? { 'Content-Disposition': `attachment; filename="receipt-${(d.receiptNo || d.id).replace(/[^\w-]/g, '')}.html"` } : {}) });
  }

  /* ---------- admin API ---------- */

  // Admin routes, all behind the Bearer token. The rate limiter only counts failed attempts and only changes the
  // failure response (401 -> 429); a correct token still passes while limited. That is acceptable only because the
  // generated token is ~185 bits; a short FS_ADMIN_TOKEN would get no real brute-force protection.
  // `key` (the donor's secret) is stripped from every admin response and export; receipt URLs are built server-side.
  // Site PUT accepts up to 48 MB because documents embed images as data URLs.
  async function adminApi(req, res, rest, prefix, url) {
    const ip = clientIP(req);
    if (!sameSecret(bearer(req), token)) {
      if (!limitAuth(ip)) { json(res, 429, { error: 'too many attempts' }); return; }
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    const base = publicBase(req, prefix, settings.publicURL);
    const parts = rest.split('/').filter(Boolean);
    const q = url.searchParams;
    const M = req.method;
    if (parts[0] === 'overview' && M === 'GET') {
      const all = ledger.all();
      const out = [];
      for (const site of sites.values()) {
        const st = ledger.stats(site.id);
        out.push({
          id: site.id, name: site.doc.name, slug: site.slug, url: base + 's/' + site.slug + '/', published: site.published,
          campaigns: livePages(site.doc).filter((p) => p.kind === 'campaign').map((p) => ({
            id: p.id, title: title(site.doc, p), slug: p.slug, currency: p.currency, goal: p.goal,
            raised: Math.round(((p.raised || 0) + (st[p.id] ? st[p.id].raised : 0)) * 100) / 100, donors: (p.donors || 0) + (st[p.id] ? st[p.id].donors : 0),
          })),
        });
      }
      json(res, 200, {
        sites: out, counts: { succeeded: all.filter((d) => d.status === 'succeeded').length, pending: all.filter((d) => d.status === 'pending' || d.status === 'created').length, wall: ledger.list({ wall: 'pending' }).length, recurring: ledger.subs().filter((s) => s.status === 'active').length },
        providers: methodsOf(null),
        endpoints: { stripe: base + 'api/webhooks/stripe', paypal: base + 'api/webhooks/paypal', tbc: base + 'api/callbacks/tbc' },
      });
      return;
    }
    if (parts[0] === 'settings') {
      if (M === 'GET') { json(res, 200, maskSettings(settings)); return; }
      if (M === 'PUT') {
        const b = await readJSON(req, 256 * 1024);
        // Secrets: an empty or masked value keeps the stored one; `clear` lists the ones to remove.
        for (const p of SECRET_PATHS) {
          const [a, k] = p.split('.');
          const v = b[a] && b[a][k];
          if (b[a] && (v === '' || v == null || /^••••/.test(String(v)))) b[a][k] = settings[a][k];
        }
        for (const p of Array.isArray(b.clear) ? b.clear : []) { if (SECRET_PATHS.includes(p)) { const [a, k] = p.split('.'); b[a] = b[a] || {}; b[a][k] = ''; } }
        const next = normSettings(b, settings);
        const xp = next.btc.xpub ? derivationSpecProblem(next.btc.xpub, next.btc.network) : '';
        if (xp) { json(res, 400, { error: 'btc.xpub: ' + xp }); return; }
        settings = next;
        storage.write('settings', settings);
        B._pp = null;
        B._tbc = null;
        log('settings updated');
        json(res, 200, maskSettings(settings));
        return;
      }
    }
    if (parts[0] === 'sites') {
      if (parts.length === 1 && M === 'GET') { json(res, 200, [...sites.values()].map((x) => ({ id: x.id, name: x.doc.name, slug: x.slug, rev: x.rev, published: x.published, pages: pageList(x) }))); return; }
      const id = parts[1];
      if (!/^[a-z0-9]{3,32}$/i.test(id || '')) { json(res, 400, { error: 'bad id' }); return; }
      if (M === 'PUT') {
        const b = await readJSON(req, 48 * 1024 * 1024);
        const site = publishSite(id, b && b.doc ? b.doc : b);
        json(res, 200, { ok: true, slug: site.slug, rev: site.rev, url: 's/' + site.slug + '/', pages: pageList(site) });
        return;
      }
      if (M === 'DELETE') { sites.delete(id); cache.delete(id); storage.remove('site:' + id); json(res, 200, { ok: true }); return; }
    }
    if (parts[0] === 'donations') {
      if (parts.length === 1 && M === 'GET') {
        const items = ledger.list({ site: q.get('site'), campaign: q.get('campaign'), status: q.get('status'), method: q.get('method'), q: q.get('q'), wall: q.get('wall') });
        const off = Math.max(0, Number(q.get('offset')) || 0);
        const lim = Math.max(1, Math.min(500, Number(q.get('limit')) || 100));
        json(res, 200, { total: items.length, items: items.slice(off, off + lim).map((d) => ({ ...d, key: undefined, receiptURL: d.status === 'succeeded' ? base + 'api/receipts/' + d.id + '?k=' + d.key : null })) });
        return;
      }
      if (parts.length === 1 && M === 'POST') {
        const b = await readJSON(req, 32 * 1024);
        const x = donationInput(b);
        const d = ledger.create({ site: x.site.id, campaign: x.camp.id, method: ['bank', 'cash', 'tbc', 'stripe', 'paypal', 'btc', 'eth', 'other'].includes(b.method) ? b.method : 'other', interval: 'once', amount: x.amount, currency: x.currency, campCur: x.camp.currency, donor: x.donor, lang: x.lang, note: line(b.note, 500) });
        ledger.addRef(d, 'manual:' + d.id);
        if (x.donor.wall) d.wall = 'approved';
        ledger.settle(d, { status: 'succeeded', rates: B.rates(d.site), receiptPrefix: settings.receipts.prefix, wallAuto: true });
        json(res, 200, { ...d, key: undefined });
        return;
      }
      const d = ledger.get(parts[1]);
      if (!d) { json(res, 404, { error: 'not found' }); return; }
      if (M === 'PATCH') {
        const b = await readJSON(req, 8192);
        if (['pending', 'approved', 'hidden'].includes(b.wall)) d.wall = b.wall;
        if (typeof b.note === 'string') d.note = line(b.note, 500);
        if (['succeeded', 'refunded', 'cancelled', 'failed'].includes(b.status) && b.status !== d.status) ledger.settle(d, { status: b.status, rates: B.rates(d.site), receiptPrefix: settings.receipts.prefix, wallAuto: B.wallAuto() });
        else ledger.save(d);
        json(res, 200, { ...d, key: undefined });
        return;
      }
      if (M === 'GET') { json(res, 200, { ...d, key: undefined }); return; }
    }
    if (parts[0] === 'recurring' && M === 'GET') { json(res, 200, ledger.subs().sort((a, b) => String(b.created).localeCompare(String(a.created)))); return; }
    if ((parts[0] === 'export.csv' || parts[0] === 'export.json') && M === 'GET') {
      const items = ledger.list({ site: q.get('site'), campaign: q.get('campaign'), status: q.get('status') });
      const name = 'donations-' + new Date().toISOString().slice(0, 10);
      if (parts[0] === 'export.json') { send(res, 200, JSON.stringify(items.map((d) => ({ ...d, key: undefined })), null, 1), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}.json"` }); return; }
      const rows = items.map((d) => ({
        id: d.id, created: d.created, paidAt: d.paidAt, status: d.status, site: d.site, campaign: d.campaign, method: d.method, interval: d.interval, renewal: d.renewal ? 'yes' : '',
        amount: d.amount, currency: d.currency, value: d.value, campaignCurrency: d.campCur, receipt: d.receiptNo, name: d.donor.name, email: d.donor.email, anonymous: d.donor.anon ? 'yes' : '',
        wall: d.donor.wall ? d.wall : '', message: d.donor.message, test: d.test ? 'yes' : '', note: d.note,
      }));
      send(res, 200, toCSV(rows, ['id', 'created', 'paidAt', 'status', 'site', 'campaign', 'method', 'interval', 'renewal', 'amount', 'currency', 'value', 'campaignCurrency', 'receipt', 'name', 'email', 'anonymous', 'wall', 'message', 'test', 'note']),
        'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}.csv"` });
      return;
    }
    if (parts[0] === 'scan' && M === 'POST') { json(res, 200, await tick(true)); return; }
    if (parts[0] === 'test' && M === 'POST') {
      try { await testProvider(B, parts[1]); json(res, 200, { ok: true }); } catch (e) { json(res, 200, { ok: false, error: e.message }); }
      return;
    }
    if (parts[0] === 'receipts' && parts[1] && M === 'GET') {
      const d = ledger.get(parts[1]);
      if (!d || d.status !== 'succeeded') { json(res, 404, { error: 'not found' }); return; }
      receipt(res, d, false);
      return;
    }
    json(res, 404, { error: 'not found' });
  }

  /* ---------- scheduler ---------- */

  // Background polling (crypto detection, monthly TBC charges): a 30 s interval that runs the real work at most every
  // pollSeconds, with a busy flag so a slow network scan never overlaps itself. unref() lets the process exit (tests)
  // even though the timer is pending. The admin "scan" button forces a run.
  let busy = false;
  let last = 0;
  async function tick(force) {
    if (busy) return { busy: true };
    if (!force && Date.now() - last < settings.pollSeconds * 1000) return { skipped: true };
    busy = true;
    last = Date.now();
    const out = { btc: 0, eth: 0, tbc: 0 };
    try {
      if (settings.btc.esplora) out.btc = await btcScan(B);
      out.eth = await ethScan(B);
      out.tbc = await tbcTick(B);
    } catch (e) { log('scheduler', e.message); } finally { busy = false; }
    return out;
  }
  const timer = setInterval(() => { tick(false); }, 30000);
  if (timer.unref) timer.unref();

  /* ---------- pages ---------- */

  // Published pages: '/s/<slug>' redirects to '/s/<slug>/' so relative links resolve; '<page>' without a slash
  // redirects to '<page>/' when that directory page exists. Lookups are in the generated file map only, so no path can
  // reach the filesystem (no traversal possible). 'no-cache' = revalidate each time (figures change).
  // KNOWN DEFECT: the 404 body interpolates `prefix` (taken from the percent-decoded request path) into an href without
  // escaping, so a crafted URL like /%22%3E%3Cscript%3E.../s/<slug>/x reflects markup into a page on this origin
  // (reflected XSS; the response has no CSP). Fix: escapeAttr(prefix), or link relative to the site root.
  async function sitePage(req, res, rest, prefix, url) {
    const parts = rest.split('/');
    const site = [...sites.values()].find((x) => x.slug === parts[0]);
    if (!site) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    if (parts.length === 1) { redirect(res, url.pathname + '/' + url.search); return true; }
    const sub = parts.slice(1).join('/');
    const files = await siteFiles(site);
    let name = sub === '' ? 'index.html' : sub.endsWith('/') ? sub + 'index.html' : files.has(sub + '/index.html') ? null : sub;
    if (name === null) { redirect(res, url.pathname + '/' + url.search); return true; }
    const html = files.get(name);
    if (html == null) { send(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><p>Not found. <a href="' + prefix + 's/' + site.slug + '/">Home</a></p>', 'text/html; charset=utf-8'); return true; }
    send(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
    return true;
  }

  return {
    // Mount-point independent: the regex takes everything before '/api/' or '/s/' as the prefix, so the backend works
    // under any base path the host chooses. Returns false for paths it does not own (the host serves them).
    // Errors: thrown errors with .status are client errors and their message is returned; anything else is a 500 with
    // a generic message (stack only in the log), so internals never reach the client.
    async handle(req, res, url) {
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { return false; }
      const m = /^(.*?\/)(api|s)\/(.*)$/.exec(p);
      if (!m) return false;
      const [, prefix, kind, rest] = m;
      try {
        if (kind === 's') return await sitePage(req, res, rest, prefix, url);
        if (rest.startsWith('admin/') || rest === 'admin') await adminApi(req, res, rest.slice(6), prefix, url);
        else await publicApi(req, res, rest, prefix, url);
      } catch (e) {
        if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'internal error' }, CORS);
        if (!e.status) log('error', req.method, p, e && e.stack || e);
      }
      return true;
    },
    // For tests and the scheduler.
    tick, ledger, B, get settings() { return settings; },
  };
}

export { paypalOf, stripeOf, tbcOf };
