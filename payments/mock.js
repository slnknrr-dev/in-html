// payments/mock.js - one local HTTP server that mimics the documented request / response shapes of Stripe, PayPal and
// TBC E-Commerce, for tests and end-to-end scenarios (never reaches a real provider; Node only).
//
//   startMockProviders({ port = 0, host = '127.0.0.1', stripe, paypal, tbc }) -> Promise<mock>
//     stripe: { secretKey, webhookSecret, webhookURL }   paypal: { clientId, secret, webhookId, webhookURL }
//     tbc: { apiKey, clientId, clientSecret }
//   mock.url                         base URL; API bases: mock.url + '/stripe', '/paypal', '/tbc'
//   mock.config                      the options above (webhook URLs may be set after start)
//   mock.log                         [{ provider, method, path, body }] of every API call
//   mock.stripe.sessions / .paypal.orders / .paypal.subscriptions / .tbc.payments    Map(id -> record)
//   mock.stripe.renew(subscriptionId) / mock.paypal.sale(subscriptionId)              a renewal webhook
//   mock.close()
// Hosted pages that stand for the provider's checkout: GET /stripe/pay/<session>[?cancel=1],
// GET /paypal/checkoutnow?token=<order>, GET /paypal/subscribe?ba_token=<subscription>, GET /tbc/checkout/<payId>[?fail=1]:
// they complete (or cancel / fail) the payment, send the provider's notification and redirect like the provider does.
//
// Design rules:
// - Fidelity where the clients branch: auth failures (401 shapes per provider), validation errors with the provider's
//   own error body shape (so providerError() is exercised for real), state machines (PayPal capture before approval is
//   a 422, a second capture is ORDER_ALREADY_CAPTURED). Everything the clients ignore is left out.
// - Webhooks are signed with the real Stripe scheme (stripeSignatureHeader), so verifyStripeSignature is tested end to
//   end. PayPal signatures are a fixed token checked by the mock's own verify endpoint, mirroring that PayPal
//   verification is a server call, not local crypto.
// - Binds 127.0.0.1 and port 0 by default: never exposed to the network, and parallel test runs cannot collide.
import http from 'node:http';
import { stripeSignatureHeader } from './stripe.js';

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

// Stripe's bracket form encoding back into objects (arrays for numeric keys).
// The container type is chosen by peeking at the *next* key: a numeric next segment means an array.
// KNOWN DEFECT: no guard against '__proto__' / 'constructor' segments, so a body like __proto__[x]=1 writes to
// Object.prototype of the mock process (test-only server on localhost, hence low impact). Fix: skip those keys or
// build on Object.create(null).
export function parseStripeForm(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    const keys = k.replace(/\]/g, '').split('[');
    let o = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) { o[key] = v; return; }
      if (o[key] == null) o[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[key];
    });
  }
  return out;
}

// Webhook / callback delivery. Never rejects: a dead receiver is recorded as status 0 on the event (ev.delivery) so
// tests can assert on delivery failures instead of crashing the mock's request handler.
function post(url, body, headers = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ status: 0, text: '' }); return; }
    const data = Buffer.from(body);
    const req = http.request(u, { method: 'POST', headers: { 'Content-Length': data.length, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.end(data);
  });
}

export async function startMockProviders({ port = 0, host = '127.0.0.1', stripe = {}, paypal = {}, tbc = {} } = {}) {
  const config = {
    stripe: { secretKey: 'sk_test_mock', webhookSecret: 'whsec_mock', webhookURL: '', ...stripe },
    paypal: { clientId: 'mock-client', secret: 'mock-secret', webhookId: 'WH-MOCK', webhookURL: '', ...paypal },
    tbc: { apiKey: 'mock-apikey', clientId: 'mock-tbc-client', clientSecret: 'mock-tbc-secret', ...tbc },
  };
  const log = [];
  let seq = 0;
  // Deterministic ids with the providers' real prefixes (cs_test_, evt_, I-...): tests can match on shape, and runs
  // are reproducible, unlike random ids.
  const next = (p) => p + (++seq).toString().padStart(6, '0');
  const S = { sessions: new Map(), subs: new Map(), events: [] };
  const PP = { orders: new Map(), subscriptions: new Map(), plans: new Map(), products: new Map(), tokens: new Set(), events: [] };
  const T = { payments: new Map(), tokens: new Set() };
  let base = '';

  const json = (res, status, v, extra = {}) => {
    const b = Buffer.from(JSON.stringify(v));
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length, ...extra });
    res.end(b);
  };
  const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
  const now = () => Math.floor(Date.now() / 1000);

  /* ---------- Stripe ---------- */

  // Signed over the exact string that is sent: JSON.stringify once, sign, send the same bytes.
  async function stripeWebhook(type, object) {
    const ev = { id: next('evt_'), object: 'event', api_version: '2024-06-20', created: now(), livemode: false, type, data: { object } };
    S.events.push(ev);
    if (!config.stripe.webhookURL) return ev;
    const payload = JSON.stringify(ev);
    ev.delivery = await post(config.stripe.webhookURL, payload, { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSignatureHeader(payload, config.stripe.webhookSecret) });
    return ev;
  }

  function invoiceOf(sub, reason) {
    return {
      id: next('in_'), object: 'invoice', billing_reason: reason, amount_paid: sub.amount, currency: sub.currency,
      customer: sub.customer, customer_email: sub.email, subscription: sub.id, status: 'paid',
      subscription_details: { metadata: sub.metadata },
    };
  }

  async function stripeAPI(req, res, path, body) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + config.stripe.secretKey) {
      json(res, 401, { error: { message: 'Invalid API Key provided: ' + auth.replace(/^Bearer\s+/, '').slice(0, 8) + '***', type: 'invalid_request_error' } });
      return;
    }
    const p = req.method === 'POST' ? parseStripeForm(body) : {};
    log.push({ provider: 'stripe', method: req.method, path, body: p });
    let m;
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const li = p.line_items && p.line_items[0];
      const pd = li && li.price_data;
      if (!pd || !pd.currency || !pd.unit_amount) { json(res, 400, { error: { message: 'Missing required param: line_items[0][price_data].', type: 'invalid_request_error' } }); return; }
      const amount = Number(pd.unit_amount) * Number(li.quantity || 1);
      // Stripe's minimum charge (50 minor units for EUR); the mock applies it to every currency, a simplification.
      if (!(amount >= 50)) { json(res, 400, { error: { message: 'The Checkout Session\'s total amount due must add up to at least €0.50 eur', type: 'invalid_request_error' } }); return; }
      if (!p.success_url || !p.cancel_url) { json(res, 400, { error: { message: 'Missing required param: success_url.', type: 'invalid_request_error' } }); return; }
      const subscription = p.mode === 'subscription';
      if (subscription && !(pd.recurring && pd.recurring.interval)) { json(res, 400, { error: { message: 'You must provide at least one recurring price in `subscription` mode when using prices.', type: 'invalid_request_error' } }); return; }
      const id = next('cs_test_');
      const s = {
        id, object: 'checkout.session', mode: p.mode || 'payment', status: 'open', payment_status: 'unpaid',
        amount_total: amount, amount_subtotal: amount, currency: pd.currency, url: base + '/stripe/pay/' + id,
        success_url: p.success_url, cancel_url: p.cancel_url, client_reference_id: p.client_reference_id || null,
        customer: null, customer_email: p.customer_email || null, customer_details: null, metadata: p.metadata || {},
        subscription: null, payment_intent: null, submit_type: p.submit_type || null, locale: p.locale || null,
        livemode: false, created: now(), _product: pd.product_data && pd.product_data.name,
      };
      S.sessions.set(id, s);
      json(res, 200, s);
      return;
    }
    if (req.method === 'GET' && (m = /^\/v1\/checkout\/sessions\/([\w-]+)$/.exec(path))) {
      const s = S.sessions.get(m[1]);
      if (!s) { json(res, 404, { error: { message: `No such checkout.session: '${m[1]}'`, type: 'invalid_request_error' } }); return; }
      json(res, 200, s);
      return;
    }
    if (req.method === 'GET' && path === '/v1/balance') {
      json(res, 200, { object: 'balance', available: [{ amount: 0, currency: 'eur' }], livemode: false, pending: [{ amount: 0, currency: 'eur' }] });
      return;
    }
    if (req.method === 'POST' && path === '/v1/billing_portal/sessions') {
      if (!p.customer) { json(res, 400, { error: { message: 'Missing required param: customer.', type: 'invalid_request_error' } }); return; }
      json(res, 200, { id: next('bps_'), object: 'billing_portal.session', customer: p.customer, return_url: p.return_url || null, url: base + '/stripe/portal/' + p.customer });
      return;
    }
    if ((m = /^\/v1\/subscriptions\/([\w-]+)$/.exec(path))) {
      const sub = S.subs.get(m[1]);
      if (!sub) { json(res, 404, { error: { message: `No such subscription: '${m[1]}'`, type: 'invalid_request_error' } }); return; }
      if (req.method === 'DELETE') { sub.status = 'canceled'; await stripeWebhook('customer.subscription.deleted', { id: sub.id, object: 'subscription', customer: sub.customer, status: 'canceled', metadata: sub.metadata }); }
      json(res, 200, { id: sub.id, object: 'subscription', status: sub.status, customer: sub.customer, metadata: sub.metadata });
      return;
    }
    json(res, 404, { error: { message: 'Unrecognized request URL (' + req.method + ': ' + path + ').', type: 'invalid_request_error' } });
  }

  // The hosted checkout: idempotent on reload (status check), events in the real order (session completed, then the
  // first invoice for subscriptions), awaited before the redirect so a test sees the webhook once the GET returns.
  async function stripePage(req, res, id, url) {
    const s = S.sessions.get(id);
    if (!s) { res.writeHead(404); res.end('no such session'); return; }
    if (url.searchParams.get('cancel')) { redirect(res, s.cancel_url); return; }
    if (s.status !== 'complete') {
      s.status = 'complete';
      s.payment_status = 'paid';
      s.customer = next('cus_');
      s.customer_details = { email: s.customer_email || 'donor@example.test', name: 'Test Donor' };
      if (s.mode === 'subscription') {
        s.subscription = next('sub_');
        S.subs.set(s.subscription, { id: s.subscription, customer: s.customer, amount: s.amount_total, currency: s.currency, email: s.customer_details.email, metadata: s.metadata, status: 'active' });
      } else s.payment_intent = next('pi_');
      await stripeWebhook('checkout.session.completed', { ...s, _product: undefined });
      if (s.subscription) await stripeWebhook('invoice.paid', invoiceOf(S.subs.get(s.subscription), 'subscription_create'));
    }
    redirect(res, s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id));
  }

  /* ---------- PayPal ---------- */

  async function paypalWebhook(type, resource) {
    const ev = { id: next('WH-'), event_version: '1.0', create_time: new Date().toISOString(), resource_type: type.split('.')[1].toLowerCase(), event_type: type, summary: type, resource };
    PP.events.push(ev);
    if (!config.paypal.webhookURL) return ev;
    ev.delivery = await post(config.paypal.webhookURL, JSON.stringify(ev), {
      'Content-Type': 'application/json', 'PAYPAL-AUTH-ALGO': 'SHA256withRSA', 'PAYPAL-CERT-URL': base + '/paypal/cert.pem',
      'PAYPAL-TRANSMISSION-ID': ev.id, 'PAYPAL-TRANSMISSION-SIG': 'valid-sig', 'PAYPAL-TRANSMISSION-TIME': ev.create_time,
    });
    return ev;
  }

  async function paypalAPI(req, res, path, body) {
    let m;
    if (req.method === 'POST' && path === '/v1/oauth2/token') {
      const want = 'Basic ' + Buffer.from(config.paypal.clientId + ':' + config.paypal.secret).toString('base64');
      log.push({ provider: 'paypal', method: req.method, path, body });
      if (req.headers.authorization !== want || !/grant_type=client_credentials/.test(body)) { json(res, 401, { error: 'invalid_client', error_description: 'Client Authentication failed' }); return; }
      const tok = next('A21AA-mock-');
      PP.tokens.add(tok);
      json(res, 200, { scope: 'https://uri.paypal.com/services/payments/payment', access_token: tok, token_type: 'Bearer', app_id: 'APP-80W284485P519543T', expires_in: 32400, nonce: next('nonce') });
      return;
    }
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (!PP.tokens.has(tok)) { json(res, 401, { error: 'invalid_token', error_description: 'Token signature verification failed' }); return; }
    let p = {};
    try { p = body ? JSON.parse(body) : {}; } catch { json(res, 400, { name: 'INVALID_REQUEST', message: 'Request is not well-formed' }); return; }
    log.push({ provider: 'paypal', method: req.method, path, body: p });
    if (req.method === 'POST' && path === '/v2/checkout/orders') {
      const pu = p.purchase_units && p.purchase_units[0];
      if (p.intent !== 'CAPTURE' || !pu || !pu.amount || !/^\d+(\.\d{1,2})?$/.test(pu.amount.value || '')) {
        json(res, 400, { name: 'INVALID_REQUEST', message: 'Request is not well-formed, syntactically incorrect, or violates schema.', details: [{ field: '/purchase_units/0/amount/value', issue: 'INVALID_PARAMETER_VALUE' }] });
        return;
      }
      const id = next('5O190127TN');
      const ctx = (p.payment_source && p.payment_source.paypal && p.payment_source.paypal.experience_context) || {};
      const o = { id, status: 'PAYER_ACTION_REQUIRED', intent: 'CAPTURE', purchase_units: [{ ...pu }], ctx, approved: false,
        links: [{ href: base + '/paypal/v2/checkout/orders/' + id, rel: 'self', method: 'GET' }, { href: base + '/paypal/checkoutnow?token=' + id, rel: 'payer-action', method: 'GET' }] };
      PP.orders.set(id, o);
      json(res, 200, { id, status: o.status, payment_source: { paypal: {} }, links: o.links });
      return;
    }
    if ((m = /^\/v2\/checkout\/orders\/([\w-]+)(\/capture)?$/.exec(path))) {
      const o = PP.orders.get(m[1]);
      if (!o) { json(res, 404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] }); return; }
      if (!m[2]) { json(res, 200, { id: o.id, status: o.status, purchase_units: o.purchase_units, links: o.links }); return; }
      if (o.status === 'COMPLETED') { json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }); return; }
      if (!o.approved) { json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED', description: 'Payer has not yet approved the Order for payment.' }] }); return; }
      o.status = 'COMPLETED';
      const pu = o.purchase_units[0];
      const cap = { id: next('3C679366HH'), status: 'COMPLETED', amount: pu.amount, custom_id: pu.custom_id, final_capture: true };
      o.capture = cap;
      json(res, 201, {
        id: o.id, status: 'COMPLETED',
        payer: { name: { given_name: 'Test', surname: 'Donor' }, email_address: 'donor@example.test', payer_id: 'PAYERMOCK1' },
        purchase_units: [{ reference_id: pu.reference_id, payments: { captures: [cap] } }],
        links: [{ href: base + '/paypal/v2/checkout/orders/' + o.id, rel: 'self', method: 'GET' }],
      });
      // Not awaited, after the response: PayPal's webhook is asynchronous to the capture call, so clients must not
      // depend on it arriving first (the test waits explicitly).
      paypalWebhook('PAYMENT.CAPTURE.COMPLETED', { ...cap, supplementary_data: { related_ids: { order_id: o.id } } });
      return;
    }
    if (req.method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
      const ok = p.webhook_id === config.paypal.webhookId && p.transmission_sig === 'valid-sig' && p.webhook_event && p.auth_algo && p.cert_url;
      json(res, 200, { verification_status: ok ? 'SUCCESS' : 'FAILURE' });
      return;
    }
    if (req.method === 'POST' && path === '/v1/catalogs/products') {
      const id = next('PROD-');
      PP.products.set(id, p);
      json(res, 201, { id, name: p.name, type: p.type, create_time: new Date().toISOString() });
      return;
    }
    if (req.method === 'POST' && path === '/v1/billing/plans') {
      const c = p.billing_cycles && p.billing_cycles[0];
      if (!PP.products.has(p.product_id) || !c || !c.pricing_scheme) { json(res, 400, { name: 'INVALID_REQUEST', details: [{ issue: 'INVALID_PARAMETER_VALUE' }] }); return; }
      const id = next('P-');
      PP.plans.set(id, p);
      json(res, 201, { id, product_id: p.product_id, name: p.name, status: 'ACTIVE' });
      return;
    }
    if (req.method === 'POST' && path === '/v1/billing/subscriptions') {
      const plan = PP.plans.get(p.plan_id);
      if (!plan) { json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_PLAN' }] }); return; }
      const id = next('I-BW452GLLEP');
      const s = { id, status: 'APPROVAL_PENDING', plan_id: p.plan_id, custom_id: p.custom_id, ctx: p.application_context || {}, price: plan.billing_cycles[0].pricing_scheme.fixed_price,
        links: [{ href: base + '/paypal/subscribe?ba_token=' + id, rel: 'approve', method: 'GET' }, { href: base + '/paypal/v1/billing/subscriptions/' + id, rel: 'self', method: 'GET' }] };
      PP.subscriptions.set(id, s);
      json(res, 201, { id, status: s.status, links: s.links });
      return;
    }
    if ((m = /^\/v1\/billing\/subscriptions\/([\w-]+)(\/cancel)?$/.exec(path))) {
      const s = PP.subscriptions.get(m[1]);
      if (!s) { json(res, 404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] }); return; }
      if (m[2]) { s.status = 'CANCELLED'; res.writeHead(204); res.end(); paypalWebhook('BILLING.SUBSCRIPTION.CANCELLED', { id: s.id, status: s.status, custom_id: s.custom_id }); return; }
      json(res, 200, { id: s.id, status: s.status, plan_id: s.plan_id, custom_id: s.custom_id, subscriber: { email_address: 'donor@example.test', name: { given_name: 'Test', surname: 'Donor' } },
        billing_info: s.lastPayment ? { last_payment: s.lastPayment } : {} });
      return;
    }
    json(res, 404, { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' });
  }

  async function paypalSale(subId) {
    const s = PP.subscriptions.get(subId);
    if (!s) return null;
    s.lastPayment = { amount: { value: s.price.value, currency_code: s.price.currency_code }, time: new Date().toISOString() };
    return paypalWebhook('PAYMENT.SALE.COMPLETED', { id: next('80021663DE'), state: 'completed', billing_agreement_id: s.id, custom: s.custom_id, amount: { total: s.price.value, currency: s.price.currency_code } });
  }

  async function paypalPage(req, res, path, url) {
    if (path === '/checkoutnow') {
      const o = PP.orders.get(url.searchParams.get('token') || '');
      if (!o) { res.writeHead(404); res.end('no such order'); return; }
      if (url.searchParams.get('cancel')) { redirect(res, o.ctx.cancel_url + (o.ctx.cancel_url.includes('?') ? '&' : '?') + 'token=' + o.id); return; }
      o.approved = true;
      o.status = 'APPROVED';
      redirect(res, o.ctx.return_url + (o.ctx.return_url.includes('?') ? '&' : '?') + 'token=' + o.id + '&PayerID=PAYERMOCK1');
      return;
    }
    if (path === '/subscribe') {
      const s = PP.subscriptions.get(url.searchParams.get('ba_token') || '');
      if (!s) { res.writeHead(404); res.end('no such subscription'); return; }
      s.status = 'ACTIVE';
      await paypalWebhook('BILLING.SUBSCRIPTION.ACTIVATED', { id: s.id, status: 'ACTIVE', custom_id: s.custom_id, plan_id: s.plan_id });
      await paypalSale(s.id);
      const ret = s.ctx.return_url || '';
      redirect(res, ret + (ret.includes('?') ? '&' : '?') + 'subscription_id=' + s.id + '&ba_token=BA-MOCK&token=EC-MOCK');
      return;
    }
    res.writeHead(404);
    res.end();
  }

  /* ---------- TBC ---------- */

  async function tbcAPI(req, res, path, body) {
    if (req.headers.apikey !== config.tbc.apiKey) {
      json(res, 401, { type: 'about:blank', title: 'Invalid Api Key', status: 401, systemCode: 'tpay-access-token.401.001', detail: 'Invalid Api Key' });
      return;
    }
    let m;
    if (req.method === 'POST' && path === '/v1/tpay/access-token') {
      const f = Object.fromEntries(new URLSearchParams(body));
      log.push({ provider: 'tbc', method: req.method, path, body: { client_id: f.client_id } });
      if (f.client_id !== config.tbc.clientId || f.client_secret !== config.tbc.clientSecret) {
        json(res, 400, { type: 'about:blank', title: 'Bad Request', status: 400, systemCode: 'tpay-access-token.400', detail: 'invalid client_id or client_secret' });
        return;
      }
      const tok = next('eyJ-mock-');
      T.tokens.add(tok);
      json(res, 200, { access_token: tok, token_type: 'Bearer', expires_in: 86400 });
      return;
    }
    if (!T.tokens.has(String(req.headers.authorization || '').replace(/^Bearer\s+/, ''))) {
      json(res, 401, { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'invalid access token' });
      return;
    }
    let p = {};
    try { p = body ? JSON.parse(body) : {}; } catch { json(res, 400, { title: 'Bad Request', status: 400 }); return; }
    log.push({ provider: 'tbc', method: req.method, path, body: p });
    const details = (x) => ({
      payId: x.payId, status: x.status, currency: x.currency, amount: x.amount, confirmedAmount: x.status === 'Succeeded' ? x.amount : 0,
      returnedAmount: x.returned || 0, links: null, transactionId: x.status === 'Succeeded' ? 'mock-' + x.payId : null, paymentMethod: 5,
      preAuth: false, recurringCard: x.saveCard && x.status === 'Succeeded' ? { recId: 'rec-' + x.payId, cardMask: '411111******1111', expiryDate: '1229' } : null,
      paymentCardNumber: null, rrn: null, extra: x.extra || null, extra2: null, httpStatusCode: 200, developerMessage: null, userMessage: null,
    });
    if (req.method === 'POST' && path === '/v1/tpay/payments') {
      if (!p.amount || !(Number(p.amount.total) > 0) || !['GEL', 'USD', 'EUR'].includes(p.amount.currency) || !p.returnurl) {
        json(res, 400, { title: 'Bad Request', status: 400, detail: 'amount and returnurl are required', resultCode: 'InvalidRequest' });
        return;
      }
      const id = next('tpay-tbvqma');
      const x = { payId: id, status: 'Created', currency: p.amount.currency, amount: Number(p.amount.total), returnurl: p.returnurl, callbackUrl: p.callbackUrl || '', saveCard: !!p.saveCard, extra: p.extra, merchantPaymentId: p.merchantPaymentId };
      T.payments.set(id, x);
      json(res, 200, {
        payId: id, status: 'Created', currency: x.currency, amount: x.amount,
        links: [{ uri: base + '/tbc/v1/tpay/payments/' + id, method: 'GET', rel: 'self' }, { uri: base + '/tbc/checkout/' + id, method: 'REDIRECT', rel: 'approval_url' }],
        transactionId: null, preAuth: false, recId: null, httpStatusCode: 200, developerMessage: null, userMessage: null,
      });
      return;
    }
    if (req.method === 'POST' && path === '/v1/tpay/payments/execution') {
      const src = [...T.payments.values()].find((x) => 'rec-' + x.payId === p.recId && x.saveCard);
      if (!src || !p.money || !(Number(p.money.amount) > 0)) { json(res, 400, { title: 'Bad Request', status: 400, detail: 'unknown recId' }); return; }
      const id = next('tpay-rec');
      const x = { payId: id, status: 'Succeeded', currency: p.money.currency, amount: Number(p.money.amount), extra: p.merchantPaymentId };
      T.payments.set(id, x);
      json(res, 200, details(x));
      return;
    }
    if ((m = /^\/v1\/tpay\/payments\/([\w-]+)$/.exec(path)) && req.method === 'GET') {
      const x = T.payments.get(m[1]);
      if (!x) { json(res, 404, { title: 'Not Found', status: 404 }); return; }
      json(res, 200, details(x));
      return;
    }
    if ((m = /^\/v1\/tpay\/payments\/([\w-]+)\/cancel$/.exec(path))) {
      const x = T.payments.get(m[1]);
      if (!x) { json(res, 404, { title: 'Not Found', status: 404 }); return; }
      x.status = 'Returned';
      x.returned = x.amount;
      json(res, 200, { httpStatusCode: 200, developerMessage: null, userMessage: null });
      return;
    }
    if ((m = /^\/v1\/tpay\/payments\/([\w-]+)\/delete$/.exec(path))) { json(res, 200, { httpStatusCode: 200 }); return; }
    json(res, 404, { title: 'Not Found', status: 404 });
  }

  // The callback carries only the PaymentId and is unsigned, as with the real bank; the client must GET the status.
  async function tbcPage(req, res, id, url) {
    const x = T.payments.get(id);
    if (!x) { res.writeHead(404); res.end('no such payment'); return; }
    if (x.status === 'Created') {
      x.status = url.searchParams.get('fail') ? 'Failed' : 'Succeeded';
      if (x.callbackUrl) x.callback = await post(x.callbackUrl, JSON.stringify({ PaymentId: x.payId }), { 'Content-Type': 'application/json' });
    }
    redirect(res, x.returnurl);
  }

  /* ---------- server ---------- */

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://mock');
      const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
      const p = url.pathname;
      let m;
      if ((m = /^\/stripe\/pay\/([\w-]+)$/.exec(p))) return await stripePage(req, res, m[1], url);
      // The customer id is reflected into HTML, so it is reduced to [\w-] first: no markup injection even in a mock.
      if (p.startsWith('/stripe/portal/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Mock portal</title><p>Customer portal of ' + p.slice(15).replace(/[^\w-]/g, '') + '</p>'); return; }
      if (p.startsWith('/stripe/')) return await stripeAPI(req, res, p.slice(7), body);
      if (p === '/paypal/checkoutnow' || p === '/paypal/subscribe') return await paypalPage(req, res, p.slice(7), url);
      if (p.startsWith('/paypal/')) return await paypalAPI(req, res, p.slice(7), body);
      if ((m = /^\/tbc\/checkout\/([\w-]+)$/.exec(p))) return await tbcPage(req, res, m[1], url);
      if (p.startsWith('/tbc/')) return await tbcAPI(req, res, p.slice(4), body);
      json(res, 404, { error: 'unknown mock route' });
    } catch (e) {
      json(res, 500, { error: String(e && e.message || e) });
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  base = `http://${host}:${server.address().port}`;
  return {
    url: base, config, log, server,
    stripe: { sessions: S.sessions, subscriptions: S.subs, events: S.events, renew: (id) => { const s = S.subs.get(id); return s ? stripeWebhook('invoice.paid', invoiceOf(s, 'subscription_cycle')) : null; }, webhook: stripeWebhook },
    paypal: { orders: PP.orders, subscriptions: PP.subscriptions, events: PP.events, sale: paypalSale, webhook: paypalWebhook },
    tbc: { payments: T.payments },
    // server.close() waits for keep-alive sockets to idle out; closeAllConnections (Node 18.2+) ends them now so the
    // test process exits promptly.
    close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}
