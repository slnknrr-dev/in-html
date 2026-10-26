// funding-studio/server-pay.js - the fiat payment flows of the backend: Checkout Sessions (Stripe), Orders v2 and
// Subscriptions (PayPal), TBC E-Commerce payments with saved cards for monthly giving; return pages, webhooks /
// callbacks, the customer portal and the monthly TBC charges. B = the backend context (backend.js): { ledger, settings(),
// request, log, storage, rates(site), receiptPrefix(), wallAuto() }.
//
// Confirmation sources per provider, strongest first (any one is enough, all are idempotent):
//   Stripe  signed webhook (HMAC over raw body) | retrieveCheckoutSession on status poll
//   PayPal  verified webhook (PayPal's verify API) | capture on return
//   TBC     no signed callback exists: the callback only carries an id, and the status is always read back from the API
// Idempotency: provider calls carry idempotency/request ids derived from the donation id (a retried checkout does not
// create a second session/order); every provider object id is stored as a ledger ref, and a ref already present
// means "already applied". Renewals create a new donation per invoice/sale id with renewal:true.
// Provider clients for PayPal/TBC are memoised on B (they cache OAuth tokens); backend.js clears them on settings save.
import { donationSessionParams, stripeClient, stripeEvent, verifyStripeSignature } from '../payments/stripe.js';
import { approveURL, donationOrder, orderCapture, paypalClient, paypalEvent } from '../payments/paypal.js';
import { approvalURL, callbackPaymentId, donationPayment, tbcClient, tbcState } from '../payments/tbc.js';
import { paypalValue } from '../payments/money.js';
import { withQuery } from './server-util.js';

export const stripeOf = (B) => { const s = B.settings().stripe; return s.secretKey ? stripeClient({ secretKey: s.secretKey, request: B.request, api: s.api || undefined }) : null; };
export const paypalOf = (B) => { const s = B.settings().paypal; return s.clientId && s.secret ? (B._pp || (B._pp = paypalClient({ clientId: s.clientId, secret: s.secret, sandbox: s.sandbox, api: s.api || '', request: B.request }))) : null; };
export const tbcOf = (B) => { const s = B.settings().tbc; return s.apiKey && s.clientId && s.clientSecret ? (B._tbc || (B._tbc = tbcClient({ apiKey: s.apiKey, clientId: s.clientId, clientSecret: s.clientSecret, api: s.api || undefined, request: B.request }))) : null; };

const settleOpts = (B, d, o) => ({ ...o, rates: B.rates(d.site), receiptPrefix: B.receiptPrefix(), wallAuto: B.wallAuto() });
// The thank-you URL carries ?d=<id>&k=<key> so the page can poll the donation status; the key is the donor's own
// capability and is only sent back to the donor's browser.
export const thanksOf = (d) => withQuery(d.thanks, { d: d.id, k: d.key });

/* ---------- checkout ---------- */

// -> url of the provider's page. base: the server's public base URL; title: the campaign title in the donor's language.
export async function createCheckout(B, d, base, title) {
  const ret = (p) => base + p + '?d=' + encodeURIComponent(d.id) + '&k=' + encodeURIComponent(d.key);
  if (d.method === 'stripe') {
    const st = stripeOf(B);
    const s = await st.createCheckoutSession(donationSessionParams({
      amount: d.amount, currency: d.currency, interval: d.interval, name: title || 'Donation', successURL: thanksOf(d), cancelURL: d.back || d.thanks,
      email: d.donor.email, donation: d.id, campaign: d.campaign, locale: d.lang,
    }), { idempotencyKey: d.id });
    B.ledger.addRef(d, 'stripe:session:' + s.id);
    d.data.session = s.id;
    d.test = s.livemode === false;
    B.ledger.settle(d, { status: 'pending' });
    return s.url;
  }
  if (d.method === 'paypal') {
    const pp = paypalOf(B);
    if (d.interval === 'month') {
      const plan = await paypalPlan(B, pp, d.amount, d.currency, title);
      const sub = await pp.createSubscription({ plan, donation: d.id, email: d.donor.email, brand: title, returnURL: ret('api/return/paypal'), cancelURL: d.back || d.thanks }, { requestId: d.id });
      B.ledger.addRef(d, 'paypal:sub:' + sub.id);
      d.data.subscription = sub.id;
      B.ledger.settle(d, { status: 'pending' });
      return approveURL(sub);
    }
    const order = await pp.createOrder(donationOrder({ amount: d.amount, currency: d.currency, donation: d.id, campaign: d.campaign, description: title, brand: title, returnURL: ret('api/return/paypal'), cancelURL: d.back || d.thanks, locale: d.lang }), { requestId: d.id });
    B.ledger.addRef(d, 'paypal:order:' + order.id);
    d.data.order = order.id;
    d.test = !!B.settings().paypal.sandbox;
    B.ledger.settle(d, { status: 'pending' });
    return approveURL(order);
  }
  if (d.method === 'tbc') {
    const tb = tbcOf(B);
    const p = await tb.createPayment(donationPayment({
      amount: d.amount, currency: d.currency, donation: d.id, description: title, returnURL: ret('api/return/tbc'), callbackURL: base + 'api/callbacks/tbc',
      lang: d.lang, methods: B.settings().tbc.methods, saveCard: d.interval === 'month',
    }));
    B.ledger.addRef(d, 'tbc:pay:' + p.payId);
    d.data.payId = p.payId;
    B.ledger.settle(d, { status: 'pending' });
    return approvalURL(p);
  }
  throw Object.assign(new Error('method not available'), { status: 400 });
}

// One catalog product and one monthly plan per amount and currency, created on demand and kept in storage.
// PayPal subscriptions need a plan with a fixed price, and donors pick arbitrary amounts; caching by
// 'CUR:amount' reuses plans so the PayPal catalogue grows only with distinct amounts.
// Race: two simultaneous first donations of a new amount may both create a plan; the later write wins and the other
// plan is merely orphaned (harmless).
async function paypalPlan(B, pp, amount, currency, title) {
  const cache = B.storage.read('paypal-plans') || { product: '', plans: {} };
  const key = currency + ':' + paypalValue(amount, currency);
  if (cache.plans[key]) return cache.plans[key];
  if (!cache.product) cache.product = (await pp.createProduct({ name: 'Monthly donation', description: String(title || '').slice(0, 120) })).id;
  const plan = await pp.createPlan({ product: cache.product, name: 'Monthly ' + key, amount, currency });
  cache.plans[key] = plan.id;
  B.storage.write('paypal-plans', cache);
  return plan.id;
}

/* ---------- PayPal ---------- */

function ensurePaypalSub(B, d, subId) {
  let s = B.ledger.subByRef('paypal', subId);
  if (!s) {
    s = B.ledger.createSub({ provider: 'paypal', ref: subId, amount: d.amount, currency: d.currency, site: d.site, campaign: d.campaign, donor: d.donor, first: d.id });
    d.sub = s.id;
    B.ledger.addRef(d, 'paypal:sub:' + subId);
    B.ledger.save(d);
  }
  return s;
}

// GET api/return/paypal?d&k&token=<order> | subscription_id=<id>: capture or confirm, then the thank-you page.
// Orders must be captured by the merchant after approval; capture uses a request id so a reloaded return page does
// not capture twice, and 422 (already captured) falls back to reading the order. Status comes from PayPal's response,
// never from the query string. Errors are logged and the donor still lands on the thank-you page (which polls).
export async function returnPaypal(B, d, q) {
  const pp = paypalOf(B);
  try {
    if (d.interval === 'month' || q.get('subscription_id')) {
      const id = q.get('subscription_id') || d.data.subscription;
      const sub = await pp.getSubscription(id);
      if (sub.status === 'ACTIVE' || sub.status === 'APPROVED') {
        ensurePaypalSub(B, d, sub.id);
        const lp = sub.billing_info && sub.billing_info.last_payment;
        if (lp) B.ledger.settle(d, settleOpts(B, d, { status: 'succeeded', amount: Number(lp.amount.value), currency: lp.amount.currency_code }));
      }
    } else {
      const orderId = q.get('token') || d.data.order;
      let order;
      try { order = await pp.captureOrder(orderId, { requestId: d.id + '-capture' }); } catch (e) {
        if (e.status === 422) order = await pp.getOrder(orderId); else throw e;
      }
      const c = orderCapture(order);
      if (c.status === 'COMPLETED' || c.captureStatus === 'COMPLETED') {
        B.ledger.addRef(d, 'paypal:capture:' + c.capture);
        if (!d.donor.name && c.name && !d.donor.anon) d.donor.name = c.name;
        B.ledger.settle(d, settleOpts(B, d, { status: 'succeeded', amount: c.amount, currency: c.currency }));
      }
    }
  } catch (e) { B.log('paypal return', d.id, e.message); }
  return thanksOf(d);
}

// Verified first (PayPal verify-webhook-signature with the configured webhook id), deduplicated second, then mapped
// to a small event vocabulary by payments/paypal.js. A subscription's first sale settles the original donation; later
// sales create renewal donations. Unknown references answer 200 so PayPal stops retrying events for other apps.
export async function paypalWebhook(B, raw, headers) {
  const pp = paypalOf(B);
  if (!pp) return { status: 503, body: { error: 'PayPal is not configured' } };
  let ev;
  try { ev = JSON.parse(new TextDecoder().decode(raw)); } catch { return { status: 400, body: { error: 'bad JSON' } }; }
  const v = await pp.verifyWebhook(headers, ev, B.settings().paypal.webhookId);
  if (!v.ok) { B.log('paypal webhook refused:', v.reason); return { status: 400, body: { error: 'verification failed' } }; }
  if (!B.seen('paypal:' + ev.id)) return { status: 200, body: { ok: true, duplicate: true } };
  const e = paypalEvent(ev);
  if (e.kind === 'paid' && e.capture) {
    const d = B.ledger.get(e.donation) || B.ledger.byRef('paypal:order:' + e.order);
    if (d && d.status !== 'succeeded') { B.ledger.addRef(d, 'paypal:capture:' + e.capture); B.ledger.settle(d, settleOpts(B, d, { status: 'succeeded', amount: e.amount, currency: e.currency })); }
  } else if (e.kind === 'paid' && e.subscription) {
    const first = B.ledger.byRef('paypal:sub:' + e.subscription);
    if (!first) return { status: 200, body: { ok: true, unknown: true } };
    const s = ensurePaypalSub(B, first, e.subscription);
    if (B.ledger.byRef('paypal:sale:' + e.sale)) return { status: 200, body: { ok: true } };
    if (first.status !== 'succeeded') {
      B.ledger.addRef(first, 'paypal:sale:' + e.sale);
      B.ledger.settle(first, settleOpts(B, first, { status: 'succeeded', amount: e.amount, currency: e.currency }));
    } else {
      const r = B.ledger.create({ site: s.site, campaign: s.campaign, method: 'paypal', interval: 'month', amount: e.amount, currency: e.currency, campCur: first.campCur, renewal: true, sub: s.id, donor: s.donor, lang: first.lang });
      B.ledger.addRef(r, 'paypal:sale:' + e.sale);
      B.ledger.settle(r, settleOpts(B, r, { status: 'succeeded' }));
    }
    s.payments = (s.payments || 0) + 1;
    B.ledger.saveSub(s);
  } else if (e.kind === 'activated') {
    const first = B.ledger.get(e.donation) || B.ledger.byRef('paypal:sub:' + e.subscription);
    if (first) ensurePaypalSub(B, first, e.subscription);
  } else if (e.kind === 'cancelled') {
    const s = B.ledger.subByRef('paypal', e.subscription);
    if (s) { s.status = 'cancelled'; B.ledger.saveSub(s); }
  } else if (e.kind === 'refunded' || e.kind === 'denied') {
    const d = B.ledger.get(e.donation) || B.ledger.byRef('paypal:capture:' + e.capture);
    if (d) B.ledger.settle(d, { status: e.kind === 'refunded' ? 'refunded' : 'failed' });
  }
  return { status: 200, body: { ok: true } };
}

/* ---------- Stripe ---------- */

// Signature is checked over the exact body text (Stripe-Signature: timestamp + HMAC-SHA256 with the webhook secret;
// the verifier also enforces a timestamp tolerance against replays). Only then is the JSON parsed.
export async function stripeWebhook(B, raw, headers) {
  const secret = B.settings().stripe.webhookSecret;
  const text = new TextDecoder().decode(raw);
  const v = verifyStripeSignature(text, String(headers['stripe-signature'] || ''), secret);
  if (!v.ok) { B.log('stripe webhook refused:', v.reason); return { status: 400, body: { error: 'signature: ' + v.reason } }; }
  let ev;
  try { ev = JSON.parse(text); } catch { return { status: 400, body: { error: 'bad JSON' } }; }
  if (!B.seen('stripe:' + ev.id)) return { status: 200, body: { ok: true, duplicate: true } };
  const e = stripeEvent(ev);
  const L = B.ledger;
  if (e.kind === 'paid' || e.kind === 'pending' || e.kind === 'failed') {
    const d = L.get(e.donation) || L.byRef('stripe:session:' + e.session);
    if (!d) return { status: 200, body: { ok: true, unknown: true } };
    if (e.paymentIntent) L.addRef(d, 'stripe:pi:' + e.paymentIntent);
    if (e.customer) d.data.customer = e.customer;
    if (!d.donor.email && e.email) d.donor.email = e.email;
    if (e.subscription) {
      L.addRef(d, 'stripe:sub:' + e.subscription);
      if (!L.subByRef('stripe', e.subscription)) {
        const s = L.createSub({ provider: 'stripe', ref: e.subscription, customer: e.customer, amount: d.amount, currency: d.currency, site: d.site, campaign: d.campaign, donor: d.donor, first: d.id });
        d.sub = s.id;
      }
    }
    d.test = !e.livemode;
    L.settle(d, settleOpts(B, d, { status: e.kind === 'paid' ? 'succeeded' : e.kind === 'failed' ? 'failed' : 'pending', amount: e.amount, currency: e.currency }));
  } else if (e.kind === 'renewal') {
    const s = L.subByRef('stripe', e.subscription);
    if (s && !L.byRef('stripe:invoice:' + e.invoice)) {
      const first = L.get(s.first);
      const r = L.create({ site: s.site, campaign: s.campaign, method: 'stripe', interval: 'month', amount: e.amount, currency: e.currency, campCur: first ? first.campCur : e.currency, renewal: true, sub: s.id, donor: s.donor, lang: first ? first.lang : '' });
      L.addRef(r, 'stripe:invoice:' + e.invoice);
      L.settle(r, settleOpts(B, r, { status: 'succeeded' }));
      s.payments = (s.payments || 0) + 1;
      L.saveSub(s);
    }
  } else if (e.kind === 'cancelled') {
    const s = L.subByRef('stripe', e.subscription);
    if (s) { s.status = 'cancelled'; L.saveSub(s); }
  } else if (e.kind === 'refunded' && e.refunded) {
    const d = L.byRef('stripe:pi:' + e.paymentIntent);
    if (d) L.settle(d, { status: 'refunded' });
  }
  return { status: 200, body: { ok: true } };
}

// A status request for a Stripe donation still pending: ask Stripe (the webhook may be late or not configured).
// Throttled to one API call per donation per 4 s (_checked is in-memory only, intentionally not persisted). The
// retrieved session is wrapped as a synthetic checkout.session.completed event so the same stripeEvent mapping is
// reused (the encode/decode round trip is redundant but harmless).
export async function refreshStripe(B, d) {
  const st = stripeOf(B);
  if (!st || !d.data.session || d.status === 'succeeded' || Date.now() - (d._checked || 0) < 4000) return;
  d._checked = Date.now();
  try {
    const s = await st.retrieveCheckoutSession(d.data.session);
    if (s.payment_status === 'paid' && d.status !== 'succeeded') {
      const raw = new TextEncoder().encode(JSON.stringify({ id: 'poll-' + d.id, type: 'checkout.session.completed', livemode: !!s.livemode, data: { object: s } }));
      const e = stripeEvent(JSON.parse(new TextDecoder().decode(raw)));
      if (e.customer) d.data.customer = e.customer;
      if (e.subscription && !B.ledger.subByRef('stripe', e.subscription)) {
        B.ledger.addRef(d, 'stripe:sub:' + e.subscription);
        const sub = B.ledger.createSub({ provider: 'stripe', ref: e.subscription, customer: e.customer, amount: d.amount, currency: d.currency, site: d.site, campaign: d.campaign, donor: d.donor, first: d.id });
        d.sub = sub.id;
      }
      B.ledger.settle(d, settleOpts(B, d, { status: 'succeeded', amount: e.amount, currency: e.currency }));
    } else if (s.status === 'expired') B.ledger.settle(d, { status: 'expired' });
  } catch (e) { B.log('stripe refresh', d.id, e.message); }
}

/* ---------- TBC ---------- */

export async function tbcUpdate(B, d) {
  const tb = tbcOf(B);
  if (!tb || !d.data.payId) return d;
  const p = await tb.getPayment(d.data.payId);
  const st = tbcState(p.status);
  if (st === 'succeeded' && d.interval === 'month' && p.recurringCard && p.recurringCard.recId && !B.ledger.subByRef('tbc', p.recurringCard.recId)) {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    const s = B.ledger.createSub({ provider: 'tbc', ref: p.recurringCard.recId, recId: p.recurringCard.recId, card: p.recurringCard.cardMask, amount: d.amount, currency: d.currency, site: d.site, campaign: d.campaign, donor: d.donor, first: d.id, next: next.toISOString() });
    d.sub = s.id;
  }
  if (st !== d.status && !(st === 'pending' && d.status === 'pending')) B.ledger.settle(d, settleOpts(B, d, { status: st, amount: p.amount, currency: p.currency }));
  return d;
}

export async function returnTbc(B, d) {
  try { await tbcUpdate(B, d); } catch (e) { B.log('tbc return', d.id, e.message); }
  return thanksOf(d);
}

// TBC posts { PaymentId } (unsigned): only the status read back from the API counts.
export async function tbcCallback(B, raw, headers) {
  const id = callbackPaymentId(raw, String(headers['content-type'] || ''));
  if (!id) return { status: 400, body: { error: 'no PaymentId' } };
  const d = B.ledger.byRef('tbc:pay:' + id);
  if (!d) return { status: 200, body: { ok: true, unknown: true } };
  try { await tbcUpdate(B, d); } catch (e) { B.log('tbc callback', id, e.message); }
  return { status: 200, body: { ok: true } };
}

// Monthly charges on saved TBC cards that are due. TBC has no subscription product, so the backend is the scheduler:
// each due sub gets a renewal donation and a merchant-initiated charge on the saved card (recId). `next` moves one
// month forward whether or not the charge worked, so a declined card is not retried every tick.
// KNOWN DEFECT: after downtime of several months, `next` advances only one month per tick, so the backlog is charged
// once per poll interval in quick succession (several charges within minutes). Fix: advance `next` past now (loop
// until next > now) and charge at most once per run.
// Note: setUTCMonth on e.g. Jan 31 rolls into March (no Feb 31), so billing days drift after short months.
export async function tbcTick(B) {
  const tb = tbcOf(B);
  if (!tb) return 0;
  let n = 0;
  for (const s of B.ledger.subs()) {
    if (s.provider !== 'tbc' || s.status !== 'active' || !s.next || Date.parse(s.next) > Date.now()) continue;
    const first = B.ledger.get(s.first);
    const r = B.ledger.create({ site: s.site, campaign: s.campaign, method: 'tbc', interval: 'month', amount: s.amount, currency: s.currency, campCur: first ? first.campCur : s.currency, renewal: true, sub: s.id, donor: s.donor, lang: first ? first.lang : '' });
    try {
      const p = await tb.executeRecurring({ recId: s.recId, amount: s.amount, currency: s.currency, donation: r.id });
      B.ledger.addRef(r, 'tbc:pay:' + p.payId);
      r.data.payId = p.payId;
      B.ledger.settle(r, settleOpts(B, r, { status: tbcState(p.status) }));
      s.payments = (s.payments || 0) + 1;
    } catch (e) {
      B.ledger.settle(r, { status: 'failed' });
      B.log('tbc recurring', s.id, e.message);
    }
    const next = new Date(s.next);
    next.setUTCMonth(next.getUTCMonth() + 1);
    s.next = next.toISOString();
    B.ledger.saveSub(s);
    n++;
  }
  return n;
}

/* ---------- recurring donors: manage ---------- */

// -> { url } (Stripe customer portal) | { cancelled: true }.
// Stripe: hand off to Stripe's hosted portal (card changes, cancel). PayPal/TBC: cancel directly. For TBC a failed
// card deletion is only logged - the sub is cancelled locally anyway, which stops future charges since this backend
// is the only scheduler.
export async function manageRecurring(B, d, base) {
  const s = d.sub ? B.ledger.sub(d.sub) : null;
  if (!s) throw Object.assign(new Error('not a monthly donation'), { status: 400 });
  if (s.provider === 'stripe') {
    const r = await stripeOf(B).createPortalSession({ customer: s.customer, return_url: d.thanks || base });
    return { url: r.url };
  }
  if (s.provider === 'paypal') await paypalOf(B).cancelSubscription(s.ref);
  if (s.provider === 'tbc') { try { await tbcOf(B).deleteRecurring(s.recId); } catch (e) { B.log('tbc delete card', e.message); } }
  s.status = 'cancelled';
  B.ledger.saveSub(s);
  return { cancelled: true };
}

// Credentials check of the admin console: a token request (no payment).
export async function testProvider(B, name) {
  if (name === 'stripe') { const st = stripeOf(B); if (!st) throw new Error('not configured'); await st.get('/v1/balance'); return true; }
  if (name === 'paypal') { const pp = paypalOf(B); if (!pp) throw new Error('not configured'); await pp.token(true); return true; }
  if (name === 'tbc') { const tb = tbcOf(B); if (!tb) throw new Error('not configured'); await tb.token(true); return true; }
  throw new Error('unknown provider');
}
