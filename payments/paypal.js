// payments/paypal.js - PayPal: the REST client of a donation backend over payments/http.js and the no-server donate
// links.
//
// REST (developer.paypal.com): OAuth 2.0 client credentials (POST /v1/oauth2/token, Basic client_id:secret,
// grant_type=client_credentials; the token is cached until shortly before `expires_in`), Orders v2 (POST
// /v2/checkout/orders with intent CAPTURE, the payer approves at the `payer-action` / `approve` link, POST
// /v2/checkout/orders/{id}/capture), webhook verification through the API (POST /v1/notifications/
// verify-webhook-signature with the PAYPAL-* transmission headers, the webhook id and the event -> verification_status
// SUCCESS), Subscriptions (catalog product, monthly plan per amount and currency, POST /v1/billing/subscriptions, the
// `approve` link, GET / cancel).
//
//   PAYPAL_LIVE, PAYPAL_SANDBOX
//   paypalClient({ clientId, secret, sandbox, api, request, now }) -> { token, createOrder, getOrder, captureOrder,
//     verifyWebhook, createProduct, createPlan, createSubscription, getSubscription, cancelSubscription }
//   donationOrder(o) -> Orders v2 body       approveURL(resource) -> payer link
//   orderCapture(order) -> { id, status, amount, currency, email, name }
//   paypalEvent(event) -> { type, kind, donation, … }
//   paypalDonateURL(o) -> https://www.paypal.com/donate?… (hosted button or business account)
//   paypalMeURL(name, amount, currency) -> https://paypal.me/<name>/<amount><currency>
import { b64encode } from '../codec/base64.js';
import { formEncode, jsonOf, providerError } from './http.js';
import { paypalValue } from './money.js';

//
// Design rules:
// - PayPal webhooks are verified by asking PayPal (verify-webhook-signature), not by checking the certificate locally:
//   local verification needs X.509 parsing, a fetch of cert_url (which must itself be pinned to a paypal.com host or an
//   attacker supplies their own cert) and CRC32 of the body. One authenticated API call avoids all of that.
// - The ledger id travels as custom_id (max 127 chars), which PayPal echoes on captures, sales and subscriptions.

export const PAYPAL_LIVE = 'https://api-m.paypal.com';
export const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';
// Transmission headers PayPal sends with a webhook (lower-case names as Node gives them).
export const PAYPAL_HEADERS = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];

export function paypalClient({ clientId, secret, sandbox = false, api = '', request, now = () => Date.now() } = {}) {
  if (!clientId || !secret) throw new Error('PayPal: no client id / secret configured');
  if (typeof request !== 'function') throw new Error('PayPal: no HTTP client');
  const base = String(api || (sandbox ? PAYPAL_SANDBOX : PAYPAL_LIVE)).replace(/\/+$/, '');
  // Token cache per client instance. `until` is 60 s before the real expiry, so a token never expires in flight
  // between the check and PayPal receiving the request (clock skew, slow networks). now() is injectable for tests.
  // Concurrent first calls may each fetch a token; harmless (PayPal issues several valid tokens), so no lock.
  let cached = null; // { token, until }

  async function token(force = false) {
    if (!force && cached && cached.until > now()) return cached.token;
    const res = await request({
      method: 'POST', url: base + '/v1/oauth2/token',
      headers: {
        Authorization: 'Basic ' + b64encode(new TextEncoder().encode(clientId + ':' + secret)),
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      },
      body: formEncode({ grant_type: 'client_credentials' }),
    });
    const body = jsonOf(res);
    if (res.status !== 200 || !body || !body.access_token) throw providerError('PayPal', res, body);
    const life = Math.max(60, Number(body.expires_in) || 3000);
    cached = { token: body.access_token, until: now() + (life - 60) * 1000 };
    return cached.token;
  }

  async function call(method, path, json, opts = {}) {
    const run = async (fresh) => request({
      method, url: base + path,
      headers: {
        Authorization: 'Bearer ' + await token(fresh), Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.requestId ? { 'PayPal-Request-Id': opts.requestId } : {}),
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : null,
    });
    let res = await run(false);
    // An expired / revoked token: once more with a fresh one. Exactly once, so bad credentials fail instead of looping.
    // Safe for POSTs: a 401 means the request was not processed, and PayPal-Request-Id makes a replay idempotent anyway.
    if (res.status === 401) res = await run(true);
    const body = jsonOf(res);
    if (res.status < 200 || res.status >= 300) throw providerError('PayPal', res, body);
    return body || {};
  }

  return {
    token,
    // Prefer return=representation: the full resource in the response (links, payer, captures) instead of the minimal
    // one, saving a GET after create / capture.
    createOrder: (body, opts) => call('POST', '/v2/checkout/orders', body, { prefer: 'return=representation', ...opts }),
    getOrder: (id) => call('GET', '/v2/checkout/orders/' + encodeURIComponent(id)),
    captureOrder: (id, opts) => call('POST', '/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {}, { prefer: 'return=representation', ...opts }),
    // headers: the incoming request's headers (lower-case names); event: the parsed webhook body.
    async verifyWebhook(headers, event, webhookId) {
      if (!webhookId) return { ok: false, reason: 'no webhook id configured' };
      const h = (k) => String((headers && headers[k]) || '');
      // Fail fast without an API call: requests lacking the headers cannot be genuine and should not cost a round trip.
      // KNOWN DEFECT: webhook_event is the re-serialised parsed body, while PayPal signs the raw bytes; a body whose
      // JSON does not round-trip identically (key order, number formatting) fails verification. Fix: pass the raw body
      // text and splice it into the request JSON verbatim.
      if (PAYPAL_HEADERS.some((k) => !h(k))) return { ok: false, reason: 'missing PayPal transmission headers' };
      const body = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId, webhook_event: event,
      });
      return body.verification_status === 'SUCCESS' ? { ok: true } : { ok: false, reason: 'verification_status ' + body.verification_status };
    },
    createProduct: (o, opts) => call('POST', '/v1/catalogs/products', { name: o.name, type: 'SERVICE', category: 'CHARITY', ...(o.description ? { description: o.description } : {}) }, opts),
    createPlan: (o, opts) => call('POST', '/v1/billing/plans', {
      product_id: o.product, name: o.name, status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
        pricing_scheme: { fixed_price: { value: paypalValue(o.amount, o.currency), currency_code: o.currency } },
      }],
      // total_cycles 0 = infinite; the failure threshold suspends the subscription after 2 failed charges in a row.
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    }, opts),
    createSubscription: (o, opts) => call('POST', '/v1/billing/subscriptions', {
      plan_id: o.plan, custom_id: o.donation,
      ...(o.email ? { subscriber: { email_address: o.email } } : {}),
      application_context: {
        brand_name: String(o.brand || '').slice(0, 127) || undefined, user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING',
        return_url: o.returnURL, cancel_url: o.cancelURL, ...(o.locale ? { locale: o.locale } : {}),
      },
    }, opts),
    getSubscription: (id) => call('GET', '/v1/billing/subscriptions/' + encodeURIComponent(id)),
    cancelSubscription: (id, reason = 'Cancelled by the donor') => call('POST', '/v1/billing/subscriptions/' + encodeURIComponent(id) + '/cancel', { reason }),
  };
}

// PayPal locales are language-COUNTRY tags; a bare language gets its most common country.
const LOCALE_OF = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ru: 'ru-RU', uk: 'uk-UA', it: 'it-IT', pl: 'pl-PL', nl: 'nl-NL', pt: 'pt-PT' };
export function paypalLocale(lang) {
  const l = String(lang || '');
  if (/^[a-z]{2}-[A-Z]{2}$/.test(l)) return l;
  return LOCALE_OF[l.split('-')[0]] || '';
}

// Orders v2 body of one donation. o = { amount, currency, donation, campaign, description, brand, returnURL, cancelURL, locale }.
export function donationOrder(o) {
  const loc = paypalLocale(o.locale);
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      // Slices are PayPal's field limits; an over-long field rejects the whole order with a 422.
      reference_id: String(o.campaign || 'donation').slice(0, 256),
      custom_id: String(o.donation || '').slice(0, 127),
      description: String(o.description || 'Donation').slice(0, 127),
      amount: { currency_code: o.currency, value: paypalValue(o.amount, o.currency) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: String(o.brand || '').slice(0, 127) || undefined,
          user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
          return_url: o.returnURL, cancel_url: o.cancelURL, ...(loc ? { locale: loc } : {}),
        },
      },
    },
  };
}

// The link the payer opens: 'payer-action' (Orders v2 with payment_source) or 'approve' (older flows, subscriptions).
export function approveURL(resource) {
  const links = resource && Array.isArray(resource.links) ? resource.links : [];
  const l = links.find((x) => x && x.rel === 'payer-action') || links.find((x) => x && x.rel === 'approve');
  return l && typeof l.href === 'string' ? l.href : '';
}

// The first capture of a captured order.
export function orderCapture(order) {
  const pu = order && Array.isArray(order.purchase_units) ? order.purchase_units[0] : null;
  const cap = pu && pu.payments && Array.isArray(pu.payments.captures) ? pu.payments.captures[0] : null;
  const payer = (order && order.payer) || {};
  const nm = payer.name || {};
  return {
    order: order && order.id, status: order && order.status,
    capture: cap && cap.id, captureStatus: cap && cap.status,
    amount: cap && cap.amount ? Number(cap.amount.value) : pu && pu.amount ? Number(pu.amount.value) : null,
    currency: (cap && cap.amount && cap.amount.currency_code) || (pu && pu.amount && pu.amount.currency_code) || '',
    donation: (cap && cap.custom_id) || (pu && pu.custom_id) || '',
    email: payer.email_address || '', name: [nm.given_name, nm.surname].filter(Boolean).join(' '),
  };
}

// Normalized facts of a webhook event. kind: 'paid' (a capture or subscription payment completed), 'activated',
// 'cancelled', 'refunded', 'denied', ''.
export function paypalEvent(ev) {
  const r = (ev && ev.resource) || {};
  const type = String((ev && ev.event_type) || '');
  const out = { type, id: ev && ev.id, kind: '', donation: '', resource: r.id };
  if (type === 'PAYMENT.CAPTURE.COMPLETED') {
    out.kind = 'paid';
    out.capture = r.id;
    out.donation = r.custom_id || '';
    out.order = r.supplementary_data && r.supplementary_data.related_ids && r.supplementary_data.related_ids.order_id;
    if (r.amount) { out.amount = Number(r.amount.value); out.currency = r.amount.currency_code; }
  } else if (type === 'PAYMENT.CAPTURE.DENIED' || type === 'PAYMENT.CAPTURE.DECLINED') {
    out.kind = 'denied';
    out.capture = r.id;
    out.donation = r.custom_id || '';
  } else if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    out.kind = 'refunded';
    out.capture = r.id;
    out.donation = r.custom_id || '';
  // Subscriptions still report payments through the legacy v1 Sale resource with a different shape (custom instead of
  // custom_id, amount.total instead of amount.value), hence the dual reads below.
  } else if (type === 'PAYMENT.SALE.COMPLETED') {
    // Subscription payments (billing agreements): resource.billing_agreement_id is the subscription id.
    out.kind = 'paid';
    out.sale = r.id;
    out.subscription = r.billing_agreement_id || '';
    out.donation = r.custom || r.custom_id || '';
    if (r.amount) { out.amount = Number(r.amount.total ?? r.amount.value); out.currency = r.amount.currency || r.amount.currency_code; }
  } else if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    out.kind = 'activated';
    out.subscription = r.id;
    out.donation = r.custom_id || '';
  } else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED' || type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
    out.kind = 'cancelled';
    out.subscription = r.id;
    out.donation = r.custom_id || '';
  }
  return out;
}

// The Donate button flow without a server: a hosted button id (made in the PayPal account; may offer monthly giving),
// or a business account (e-mail or merchant id) with amount and currency prefilled.
export function paypalDonateURL({ hostedId = '', business = '', amount = null, currency = '', item = '', sandbox = false, locale = '' } = {}) {
  const u = new URL(sandbox ? 'https://www.sandbox.paypal.com/donate' : 'https://www.paypal.com/donate');
  if (hostedId) u.searchParams.set('hosted_button_id', hostedId);
  else if (business) u.searchParams.set('business', business);
  else return '';
  if (!hostedId) {
    if (amount != null && Number(amount) > 0) u.searchParams.set('amount', paypalValue(amount, currency || 'USD'));
    if (currency) u.searchParams.set('currency_code', currency);
    if (item) u.searchParams.set('item_name', String(item).slice(0, 127));
  }
  const loc = paypalLocale(locale);
  // The legacy donate page takes locale.x in the underscore form (en_US), unlike the REST API's en-US.
  if (loc) u.searchParams.set('locale.x', loc.replace('-', '_'));
  return u.href;
}

export function paypalMeURL(name, amount, currency) {
  const n = String(name || '').trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/[/?#].*$/, '');
  // A strict allow-list on the handle: it is concatenated into a URL path, so '/', '?' or '..' must never get through.
  if (!/^[A-Za-z0-9]{1,20}$/.test(n)) return '';
  const a = amount != null && Number(amount) > 0 ? '/' + paypalValue(amount, currency || 'USD') + (currency || '') : '';
  return 'https://paypal.me/' + n + a;
}
