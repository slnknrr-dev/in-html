// payments/stripe.js - Stripe: form encoding of API parameters, webhook signatures (the documented `Stripe-Signature`
// scheme), a minimal REST client (Checkout Sessions, the customer portal, subscriptions) over payments/http.js, the
// Checkout Session of a donation (one-time or monthly with price_data), Payment Link URLs and a summary of the webhook
// events a donation ledger needs.
//
// Webhook signatures (stripe.com/docs/webhooks#verify-manually): header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…][,v0=…]`;
// signed payload = `${t}.${rawBody}`; expected v1 = hex(HMAC-SHA256(endpoint secret as UTF-8, signed payload)); any
// matching v1 passes (secret rotation sends several); the timestamp must be within the tolerance (default 300 s).
//
//   stripeEncode(params) -> 'mode=payment&line_items[0][quantity]=1…'   (nested objects / arrays, bracket keys)
//   stripeSign(payload, secret, t) -> hex                     stripeSignatureHeader(payload, secret, t) -> header
//   verifyStripeSignature(payload, header, secret, { tolerance, now }) -> { ok, t, reason? }
//   stripeClient({ secretKey, request, api }) -> { post, get, createCheckoutSession, retrieveCheckoutSession,
//     createPortalSession, retrieveSubscription, cancelSubscription }
//   donationSessionParams(o) -> Checkout Session parameters        paymentLinkURL(url, o) -> URL with prefills
//   stripeEvent(event) -> { type, kind, donation, … } normalized facts of the events a ledger handles
import { hmac } from '../crypto/hmac.js';
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex, utf8ToBytes } from '../crypto/encoding.js';
import { formEncode, jsonOf, providerError } from './http.js';
import { stripeMajor, stripeMinor } from './money.js';

//
// Design rules:
// - The webhook is the source of truth, the browser redirect to success_url is not: a donor can close the tab, and a
//   success URL can be opened by hand. The ledger changes only on a verified event.
// - Signature verification runs on the raw body bytes exactly as received. Re-serialising parsed JSON changes key order
//   and whitespace and breaks the HMAC, so the caller must keep the raw body.
// - Ledger ids travel in metadata AND client_reference_id: metadata is copied to the PaymentIntent / Subscription, so
//   later events (invoice.paid, charge.refunded) can be tied back to the donation without an extra API lookup.

export const STRIPE_API = 'https://api.stripe.com';
// Checkout locales Stripe accepts (others become 'auto').
const LOCALES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA', 'hr', 'hu', 'id',
  'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh',
  'zh-HK', 'zh-TW'];

export function stripeLocale(lang) {
  const l = String(lang || '');
  if (LOCALES.includes(l)) return l;
  const p = l.split('-')[0];
  return LOCALES.includes(p) ? p : 'auto';
}

// Nested parameters in Stripe's form encoding: { a: { b: 1 }, c: [{ d: 2 }] } -> a[b]=1&c[0][d]=2.
// Stripe's API is form-encoded, not JSON; nesting is expressed through bracket keys. Explicit array indexes ([0]) rather
// than empty brackets: arrays of objects need them so fields of one element stay together. Brackets are decoded back
// after formEncode for readability in logs; the server accepts both forms. null / undefined values are skipped (not
// sent as ''), because '' means "unset this field" to the Stripe API.
export function stripeEncode(params) {
  const flat = {};
  const walk = (v, key) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${key}[${i}]`)); return; }
    if (typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], key ? `${key}[${k}]` : k); return; }
    flat[key] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  };
  walk(params, '');
  return formEncode(flat).replace(/%5B/g, '[').replace(/%5D/g, ']');
}

export function stripeSign(payload, secret, t) {
  return bytesToHex(hmac(sha256, utf8ToBytes(String(secret)), utf8ToBytes(`${t}.${payload}`)));
}

export function stripeSignatureHeader(payload, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${stripeSign(payload, secret, t)}`;
}

// Constant-time comparison of two hex strings of equal length.
// Why: an early-exit === leaks, through response timing, how many leading characters of a forged signature match,
// which allows byte-by-byte forgery. XOR-accumulating every position makes the time independent of the content.
// The length check may exit early: lengths are public (always 64 hex chars for SHA-256).
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function verifyStripeSignature(payload, header, secret, { tolerance = 300, now = Date.now() / 1000 } = {}) {
  if (!secret) return { ok: false, reason: 'no webhook secret configured' };
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'no Stripe-Signature header' };
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t == null) return { ok: false, reason: 'no timestamp in the signature header' };
  if (!v1.length) return { ok: false, reason: 'no v1 signature in the header' };
  // Order of checks: signature before timestamp, so an attacker cannot learn tolerance behaviour without a valid MAC.
  // The tolerance bounds replay: a captured valid request becomes useless after 5 minutes. Idempotent ledger updates
  // (keyed by event id) are still needed, because Stripe itself redelivers events.
  const want = stripeSign(typeof payload === 'string' ? payload : new TextDecoder().decode(payload), secret, t);
  if (!v1.some((s) => sameHex(s, want))) return { ok: false, t, reason: 'signature mismatch' };
  if (tolerance > 0 && Math.abs(now - t) > tolerance) return { ok: false, t, reason: 'timestamp outside the tolerance' };
  return { ok: true, t };
}

export function stripeClient({ secretKey, request, api = STRIPE_API, version = '' } = {}) {
  if (!secretKey) throw new Error('Stripe: no secret key configured');
  if (typeof request !== 'function') throw new Error('Stripe: no HTTP client');
  const base = String(api || STRIPE_API).replace(/\/+$/, '');
  const headers = (extra) => ({
    Authorization: 'Bearer ' + secretKey,
    ...(version ? { 'Stripe-Version': version } : {}),
    ...extra,
  });
  // Idempotency-Key: a retried POST with the same key returns the first result instead of creating a second Checkout
  // Session or charge. Callers derive it from the ledger id so a network-timeout retry cannot double-charge.
  // GET parameters go in the query string with the same bracket encoding; DELETE sends neither query nor body.
  async function call(method, path, params, opts = {}) {
    const q = method === 'GET' && params ? '?' + stripeEncode(params) : '';
    const res = await request({
      method, url: base + path + (q.length > 1 ? q : ''),
      headers: headers({
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      }),
      body: method === 'POST' ? stripeEncode(params || {}) : null,
    });
    const body = jsonOf(res);
    if (res.status < 200 || res.status >= 300) throw providerError('Stripe', res, body);
    return body;
  }
  return {
    post: (path, params, opts) => call('POST', path, params, opts),
    get: (path, params) => call('GET', path, params),
    createCheckoutSession: (params, opts) => call('POST', '/v1/checkout/sessions', params, opts),
    retrieveCheckoutSession: (id) => call('GET', '/v1/checkout/sessions/' + encodeURIComponent(id)),
    createPortalSession: ({ customer, return_url: ret }) => call('POST', '/v1/billing_portal/sessions', { customer, return_url: ret }),
    retrieveSubscription: (id) => call('GET', '/v1/subscriptions/' + encodeURIComponent(id)),
    cancelSubscription: (id) => call('DELETE', '/v1/subscriptions/' + encodeURIComponent(id)),
  };
}

// Checkout Session of one donation. o = { amount (major units), currency, interval: 'once' | 'month', name (line item
// name), description, successURL, cancelURL, email, donation (ledger id), campaign, locale }.
export function donationSessionParams(o) {
  // Stripe expects lower-case currency codes; stripeMinor's lists are upper case, hence the round trip.
  // price_data creates an ad-hoc Price per session: any donor-chosen amount works without pre-made Prices.
  const cur = String(o.currency || 'EUR').toLowerCase();
  const monthly = o.interval === 'month';
  const meta = { donation: o.donation || '', campaign: o.campaign || '' };
  const item = {
    quantity: 1,
    price_data: {
      currency: cur,
      unit_amount: stripeMinor(o.amount, cur.toUpperCase()),
      product_data: { name: String(o.name || 'Donation').slice(0, 250), ...(o.description ? { description: String(o.description).slice(0, 500) } : {}) },
      ...(monthly ? { recurring: { interval: 'month' } } : {}),
    },
  };
  const p = {
    mode: monthly ? 'subscription' : 'payment',
    line_items: [item],
    success_url: o.successURL,
    cancel_url: o.cancelURL,
    client_reference_id: o.donation || undefined,
    metadata: meta,
    locale: stripeLocale(o.locale),
  };
  if (o.email) p.customer_email = o.email;
  // Metadata on the session alone is not inherited: it must be set on the object later events carry (Subscription for
  // invoices, PaymentIntent for charges). submit_type 'donate' only relabels the button and is invalid in subscription
  // mode, as is payment_intent_data.
  if (monthly) p.subscription_data = { metadata: meta };
  else {
    p.submit_type = 'donate';
    p.payment_intent_data = { metadata: meta, ...(o.description ? { description: String(o.description).slice(0, 500) } : {}) };
  }
  return p;
}

// A Payment Link (buy.stripe.com/…) with the prefills Stripe documents: client_reference_id, prefilled_email, locale.
export function paymentLinkURL(url, o = {}) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  // Character set and length are Stripe's documented limits for client_reference_id on Payment Links; anything else is
  // dropped rather than sent, since Stripe silently ignores an invalid value and the donation would be unattributable.
  // https only: a configured http: link would be a downgrade a donor should never be sent to.
  if (o.ref && /^[A-Za-z0-9_-]{1,200}$/.test(o.ref)) u.searchParams.set('client_reference_id', o.ref);
  if (o.email) u.searchParams.set('prefilled_email', o.email);
  if (o.locale && stripeLocale(o.locale) !== 'auto') u.searchParams.set('locale', stripeLocale(o.locale));
  return u.href;
}

// Normalized facts of a webhook event. kind:
//   'paid'      a Checkout Session completed and paid (or its async payment succeeded)
//   'pending'   a Checkout Session completed but the payment is still processing
//   'failed'    the async payment of a session failed
//   'renewal'   an invoice of a subscription was paid (billing_reason subscription_cycle)
//   'first'     the first invoice of a subscription was paid (subscription_create)
//   'cancelled' a subscription ended
//   'refunded'  a charge was refunded (fully or partly)
//   ''          anything else
export function stripeEvent(ev) {
  const o = ev && ev.data && ev.data.object ? ev.data.object : {};
  const type = String((ev && ev.type) || '');
  const meta = o.metadata || {};
  const out = { type, id: ev && ev.id, kind: '', livemode: !!(ev && ev.livemode), donation: meta.donation || o.client_reference_id || '', campaign: meta.campaign || '' };
  const money = (minor, cur) => (cur ? { amount: stripeMajor(minor, String(cur).toUpperCase()), currency: String(cur).toUpperCase() } : {});
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded' || type === 'checkout.session.async_payment_failed') {
    // checkout.session.completed does not mean money arrived: delayed methods (SEPA debit, bank transfers) complete
    // with payment_status 'unpaid' and later fire async_payment_succeeded / failed. Hence 'pending'.
    const paid = o.payment_status === 'paid' || o.payment_status === 'no_payment_required';
    out.kind = type.endsWith('failed') ? 'failed' : paid ? 'paid' : 'pending';
    Object.assign(out, money(o.amount_total, o.currency));
    out.session = o.id;
    out.customer = typeof o.customer === 'string' ? o.customer : o.customer && o.customer.id;
    out.subscription = typeof o.subscription === 'string' ? o.subscription : o.subscription && o.subscription.id;
    out.paymentIntent = typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent && o.payment_intent.id;
    out.email = (o.customer_details && o.customer_details.email) || o.customer_email || '';
    out.name = (o.customer_details && o.customer_details.name) || '';
    out.mode = o.mode;
  } else if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
    const reason = o.billing_reason;
    // 'first' is separated from 'renewal' because the first invoice coincides with checkout.session.completed; the
    // ledger must not count that payment twice.
    out.kind = reason === 'subscription_cycle' ? 'renewal' : reason === 'subscription_create' ? 'first' : '';
    Object.assign(out, money(o.amount_paid, o.currency));
    out.invoice = o.id;
    out.customer = typeof o.customer === 'string' ? o.customer : o.customer && o.customer.id;
    // API versions differ on where the subscription id lives.
    const sub = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
    out.subscription = typeof sub === 'string' ? sub : sub && sub.id;
    const sd = o.subscription_details || (o.parent && o.parent.subscription_details) || {};
    out.donation = out.donation || (sd.metadata && sd.metadata.donation) || '';
    out.campaign = out.campaign || (sd.metadata && sd.metadata.campaign) || '';
    out.email = o.customer_email || '';
    out.name = o.customer_name || '';
  } else if (type === 'customer.subscription.deleted') {
    out.kind = 'cancelled';
    out.subscription = o.id;
    out.customer = typeof o.customer === 'string' ? o.customer : o.customer && o.customer.id;
  } else if (type === 'charge.refunded') {
    out.kind = 'refunded';
    out.paymentIntent = typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent && o.payment_intent.id;
    // amount_refunded is cumulative over all refunds of the charge, not this refund's delta; refunded true means full.
    out.refunded = o.refunded === true;
    Object.assign(out, money(o.amount_refunded, o.currency));
  }
  return out;
}
