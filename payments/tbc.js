// payments/tbc.js - TBC Bank (Georgia) E-Commerce checkout ("TPay", developers.tbcbank.ge): the REST client of a donation
// backend over payments/http.js, the payment statuses, and the no-server details of a bank transfer.
//
// API (production base https://api.tbcbank.ge, version v1; every call sends the developer app key in the `apikey`
// header):
//   POST /v1/tpay/access-token        application/x-www-form-urlencoded client_id, client_secret
//                                     -> { access_token, token_type: 'Bearer', expires_in: 86400 }
//   POST /v1/tpay/payments            Authorization: Bearer; JSON { amount: { currency, total, subTotal, tax, shipping },
//                                     returnurl, callbackUrl, extra, expirationMinutes, methods, preAuth, language,
//                                     merchantPaymentId, saveCard, description } -> { payId, status: 'Created',
//                                     links: [{ uri, method: 'REDIRECT', rel: 'approval_url' }, …], recId, … }
//   GET  /v1/tpay/payments/{payId}    -> { payId, status, currency, amount, confirmedAmount, returnedAmount,
//                                     paymentMethod, recurringCard: { recId, cardMask, expiryDate } | null, … }
//   POST /v1/tpay/payments/{payId}/cancel           { amount }
//   POST /v1/tpay/payments/execution  { recId, money: { currency, amount }, initiator: 'merchant', merchantPaymentId }
//                                     (a charge on a saved card: monthly donations)
//   POST /v1/tpay/payments/{recId}/delete           forget a saved card
// Callback: when a payment reaches a final status TBC POSTs { PaymentId } to callbackUrl (or the URL set in the
// merchant dashboard) from fixed addresses; the callback is not signed, so the backend answers 200 and reads the
// status with GET /payments/{payId} - only that answer counts.
// Statuses: Created, Processing, Succeeded, Failed, Expired, WaitingConfirm (pre-authorization), CancelPaymentProcessing,
// PaymentCompletionProcessing, Returned, PartialReturned. Final: Succeeded, Failed, Expired, WaitingConfirm.
// Methods (`methods` codes): 4 Web QR / BNPL, 5 card, 7 internet bank login, 8 installments (none = every method the
// merchant has).
//
//   TBC_API, TBC_STATUSES, TBC_FINAL, TBC_METHODS
//   tbcClient({ apiKey, clientId, clientSecret, api, request, now }) -> { token, createPayment, getPayment, cancelPayment,
//     executeRecurring, deleteRecurring }
//   donationPayment(o) -> create-payment body      approvalURL(payment) -> the checkout page
//   tbcState(status) -> 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded'
//   tbcLanguage(lang) -> 'KA' | 'EN' | 'RU'
//   callbackPaymentId(body) -> payId from a callback body (JSON or form)
import { formEncode, jsonOf, providerError } from './http.js';
import { roundAmount } from './money.js';

//
// Design rules:
// - The unsigned callback is only a hint to re-read: the backend never trusts its body, it fetches the payment by id
//   with its own credentials. That turns a spoofable notification into an authenticated pull, so the IP allow-list is
//   defence in depth, not the security boundary.
// - Amounts are major units as JSON numbers (TBC's format), rounded to the currency's minor units first, so a float
//   such as 10.000000001 never reaches the bank.

export const TBC_API = 'https://api.tbcbank.ge';
export const TBC_STATUSES = ['Created', 'Processing', 'Succeeded', 'Failed', 'Expired', 'WaitingConfirm', 'CancelPaymentProcessing',
  'PaymentCompletionProcessing', 'Returned', 'PartialReturned'];
export const TBC_FINAL = ['Succeeded', 'Failed', 'Expired', 'WaitingConfirm'];
export const TBC_METHODS = { 4: 'qr', 5: 'card', 7: 'ibank', 8: 'installments' };
// IP addresses the bank sends callbacks from (developers.tbcbank.ge, "Callback URL").
export const TBC_CALLBACK_IPS = ['193.104.20.44', '193.104.20.45', '185.52.80.44', '185.52.80.45'];

// Collapse the bank's statuses to the ledger's states. WaitingConfirm stays 'pending' although TBC calls it final:
// it is a pre-authorisation hold, the money is not captured until confirmed (this module always sends preAuth false).
export function tbcState(status) {
  switch (status) {
    case 'Succeeded': return 'succeeded';
    case 'Failed': return 'failed';
    case 'Expired': return 'expired';
    case 'Returned': case 'PartialReturned': return 'refunded';
    default: return 'pending';
  }
}

export function tbcLanguage(lang) {
  const p = String(lang || '').split('-')[0].toLowerCase();
  return p === 'ka' ? 'KA' : p === 'ru' ? 'RU' : 'EN';
}

export function tbcClient({ apiKey, clientId, clientSecret, api = TBC_API, request, now = () => Date.now() } = {}) {
  if (!apiKey || !clientId || !clientSecret) throw new Error('TBC: API key, client id and client secret are needed');
  if (typeof request !== 'function') throw new Error('TBC: no HTTP client');
  const base = String(api || TBC_API).replace(/\/+$/, '');
  // Same token-cache scheme as paypal.js; a 120 s safety margin against a 24 h token lifetime.
  let cached = null;

  async function token(force = false) {
    if (!force && cached && cached.until > now()) return cached.token;
    const res = await request({
      method: 'POST', url: base + '/v1/tpay/access-token',
      headers: { apikey: apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formEncode({ client_id: clientId, client_secret: clientSecret }),
    });
    const body = jsonOf(res);
    if (res.status !== 200 || !body || !body.access_token) throw providerError('TBC', res, body);
    const life = Math.max(120, Number(body.expires_in) || 86400);
    cached = { token: body.access_token, until: now() + (life - 120) * 1000 };
    return cached.token;
  }

  async function call(method, path, json) {
    const run = async (fresh) => request({
      method, url: base + path,
      headers: { apikey: apiKey, Authorization: 'Bearer ' + await token(fresh), Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : null,
    });
    let res = await run(false);
    // One retry with a fresh token; a 401 means unprocessed, so retrying a POST cannot create a duplicate payment.
    if (res.status === 401) res = await run(true);
    const body = jsonOf(res);
    if (res.status < 200 || res.status >= 300) throw providerError('TBC', res, body);
    return body || {};
  }

  return {
    token,
    createPayment: (body) => call('POST', '/v1/tpay/payments', body),
    getPayment: (payId) => call('GET', '/v1/tpay/payments/' + encodeURIComponent(payId)),
    cancelPayment: (payId, amount) => call('POST', '/v1/tpay/payments/' + encodeURIComponent(payId) + '/cancel', { amount }),
    executeRecurring: (o) => call('POST', '/v1/tpay/payments/execution', {
      recId: o.recId, money: { currency: o.currency, amount: roundAmount(o.amount, o.currency) },
      initiator: 'merchant', ...(o.donation ? { merchantPaymentId: o.donation } : {}),
    }),
    deleteRecurring: (recId) => call('POST', '/v1/tpay/payments/' + encodeURIComponent(recId) + '/delete', {}),
  };
}

// ANSI-only extra field (TBC accepts at most 25 characters there).
// Printable ASCII only, by removal rather than rejection: the field is informational, a lossy copy beats a failed
// payment creation.
const ansi = (s, n) => String(s || '').replace(/[^\x20-\x7e]/g, '').slice(0, n);

// Create-payment body of one donation. o = { amount, currency ('GEL'), donation, description, returnURL, callbackURL,
// lang, methods: [5, 7…] (optional), saveCard (monthly donations), expirationMinutes }.
export function donationPayment(o) {
  const total = roundAmount(o.amount, o.currency || 'GEL');
  const body = {
    amount: { currency: o.currency || 'GEL', total, subTotal: 0, tax: 0, shipping: 0 },
    returnurl: o.returnURL,
    preAuth: false,
    language: tbcLanguage(o.lang),
    merchantPaymentId: String(o.donation || ''),
    description: String(o.description || 'Donation').slice(0, 30),
    extra: ansi(o.donation, 25),
  };
  if (o.callbackURL) body.callbackUrl = o.callbackURL;
  // Clamp to the 1-60 range instead of passing through: out-of-range values are rejected by the API.
  if (o.expirationMinutes) body.expirationMinutes = Math.max(1, Math.min(60, Math.round(o.expirationMinutes)));
  const ms = Array.isArray(o.methods) ? [...new Set(o.methods.map(Number).filter((m) => Object.prototype.hasOwnProperty.call(TBC_METHODS, m)))] : [];
  if (ms.length) body.methods = ms;
  if (o.saveCard) body.saveCard = true;
  return body;
}

export function approvalURL(payment) {
  const links = payment && Array.isArray(payment.links) ? payment.links : [];
  const l = links.find((x) => x && x.rel === 'approval_url') || links.find((x) => x && String(x.method).toUpperCase() === 'REDIRECT');
  return l && typeof l.uri === 'string' ? l.uri : '';
}

// The callback body: JSON { PaymentId } (also accepted: paymentId / payId, or the same as form fields).
export function callbackPaymentId(raw, contentType = '') {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw || new Uint8Array());
  let o = null;
  if (/json/i.test(contentType) || /^\s*\{/.test(text)) { try { o = JSON.parse(text); } catch { o = null; } }
  if (!o) { try { o = Object.fromEntries(new URLSearchParams(text)); } catch { o = {}; } }
  // The id is later interpolated into a URL path (encodeURIComponent'd anyway); the allow-list rejects junk early so a
  // spoofed callback cannot even trigger an API lookup with arbitrary input.
  const v = o && (o.PaymentId || o.paymentId || o.payId || o.PayId);
  return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(v) ? v : '';
}
