// payments/test.js - tests of the payments library: `node payments/test.js` (also `node check.js tests payments`;
// importing the module runs nothing). Money parsing and minor units, IBAN / BIC / the EPC QR example of EPC069-12,
// Stripe's form encoding and webhook signatures (computed vectors, cross-checked against node:crypto, rotation, replay
// window, tampering), and the Stripe / PayPal / TBC clients against payments/mock.js, a local server that mimics the
// documented request / response shapes (nothing reaches a real provider).
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { convert, decimalString, formatMoney, fromMinor, minorUnits, parseAmount, paypalValue, stripeMajor, stripeMinor, toMinor } from './money.js';
import { epcPayload, formatIBAN, ibanProblem, validBIC, validIBAN } from './iban.js';
import { donationSessionParams, paymentLinkURL, stripeClient, stripeEncode, stripeEvent, stripeSign, stripeSignatureHeader, verifyStripeSignature } from './stripe.js';
import { approveURL, donationOrder, orderCapture, paypalClient, paypalDonateURL, paypalEvent, paypalMeURL } from './paypal.js';
import { approvalURL, callbackPaymentId, donationPayment, tbcClient, tbcState } from './tbc.js';
import { formEncode, nodeRequester } from './http.js';
import { parseStripeForm, startMockProviders } from './mock.js';

// Main-module check by resolved path: importing from check.js must not run the suite twice.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// A local receiver of webhooks / callbacks: { url, hits: [{ path, headers, body }], close() }.
async function receiver() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { hits.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }); res.writeHead(200); res.end('ok'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

// GET without following redirects -> { status, location }.
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '' })); }).on('error', reject);
  });
}

export async function run() {
  let pass = 0, fail = 0;
  // JSON comparison: deep equality without a dependency; adequate because every compared value is JSON data
  // (undefined array entries serialise as null, which the 'session params monthly' check relies on consistently).
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info) : ''}`); } };
  const rejects = async (name, p, re) => {
    try { await p; fail++; console.log(`FAIL ${name}: no error`); } catch (e) { if (!re || re.test(e.message)) pass++; else { fail++; console.log(`FAIL ${name}: ${e.message}`); } }
  };

  // --- money ----------------------------------------------------------------------------------------
  // The parseAmount table pins the separator heuristic's ambiguous cases: '1,234' is thousands, '0.500' and '0,05'
  // are decimals (zero head), '1e3' is refused (exponent syntax is never what a donor means).
  // toMinor(1.005) = 101 is the float-drift trap that Math.round(v * 100) gets wrong.
  for (const [txt, want] of [['12', 12], ['12,5', 12.5], ['12.50', 12.5], ['1 234,56', 1234.56], ['1,234.56', 1234.56], ['1.234,56', 1234.56],
    ['1,234', 1234], ['1.000.000', 1000000], ['0.500', 0.5], ['0,05', 0.05], ['', null], ['-5', null], ['abc', null], ['1e3', null], ["10'000", 10000]]) {
    eq(`parseAmount ${txt}`, parseAmount(txt), want);
  }
  eq('minorUnits', [minorUnits('EUR'), minorUnits('JPY'), minorUnits('BHD'), minorUnits('GEL'), minorUnits('XYZ')], [2, 0, 3, 2, 2]);
  eq('toMinor', [toMinor(12.5, 'EUR'), toMinor(0.29, 'EUR'), toMinor(1.005, 'EUR'), toMinor(1000, 'JPY'), toMinor(1.2345, 'BHD')], [1250, 29, 101, 1000, 1235]);
  eq('fromMinor', [fromMinor(1250, 'EUR'), fromMinor(1000, 'JPY')], [12.5, 1000]);
  eq('stripeMinor', [stripeMinor(25, 'EUR'), stripeMinor(500, 'JPY'), stripeMinor(1.234, 'KWD'), stripeMinor(19.99, 'usd')], [2500, 500, 1230, 1999]);
  eq('stripeMajor', [stripeMajor(2500, 'EUR'), stripeMajor(500, 'JPY'), stripeMajor(1230, 'KWD')], [25, 500, 1.23]);
  eq('paypalValue', [paypalValue(10, 'EUR'), paypalValue(10.5, 'USD'), paypalValue(1000, 'JPY')], ['10.00', '10.50', '1000']);
  eq('decimalString', [decimalString(0.1 + 0.2, 2), decimalString(5, 0)], ['0.30', '5']);
  eq('convert', [convert(100, 'USD', 'EUR', { 'USD:EUR': 0.9 }), convert(90, 'EUR', 'USD', { 'USD:EUR': 0.9 }), Math.round(convert(100, 'USD', 'GEL', { 'USD:EUR': 0.9, 'EUR:GEL': 3 })), convert(1, 'USD', 'GBP', {})], [90, 100, 270, null]);
  ok('formatMoney', /12/.test(formatMoney(12, 'EUR', 'de')) && /€/.test(formatMoney(12, 'EUR', 'en')), formatMoney(12, 'EUR', 'en'));

  // --- IBAN / BIC / EPC QR ---------------------------------------------------------------------------
  // The problem vectors each break exactly one layer (last digit, one char short, unknown country, garbage), proving
  // ibanProblem reports the first failing criterion.
  for (const s of ['GB29 NWBK 6016 1331 9268 19', 'DE89370400440532013000', 'GE29NB0000000101904917', 'BE72000000001616', 'fr14 2004 1010 0505 0001 3m02 606']) ok('IBAN valid ' + s, validIBAN(s), ibanProblem(s));
  eq('IBAN problems', ['GB29NWBK60161331926818', 'GE29NB000000010190491', 'ZZ29NWBK60161331926819', 'hello'].map(ibanProblem), ['checksum', 'length', 'country', 'format']);
  eq('formatIBAN', formatIBAN('ge29nb0000000101904917'), 'GE29 NB00 0000 0101 9049 17');
  eq('BIC', ['TBCBGE22', 'BPOTBEB1', 'DEUTDEFF500', 'TBCB', 'tbcbge22'].map(validBIC), [true, true, true, false, true]);
  // The sample of the EPC069-12 guideline (version 001 with BIC, charity purpose code).
  eq('EPC QR guideline sample', epcPayload({ version: '001', bic: 'BPOTBEB1', name: 'Red Cross of Belgium', iban: 'BE72000000001616', amount: 1, purpose: 'CHAR', text: 'Urgency fund', info: 'Sample EPC QR code' }),
    'BCD\n001\n1\nSCT\nBPOTBEB1\nRed Cross of Belgium\nBE72000000001616\nEUR1\nCHAR\n\nUrgency fund\nSample EPC QR code');
  eq('EPC QR minimal 002', epcPayload({ name: 'Example Fund', iban: 'DE89370400440532013000', amount: 12.5 }), 'BCD\n002\n1\nSCT\n\nExample Fund\nDE89370400440532013000\nEUR12.5');
  ok('EPC rejects bad IBAN', (() => { try { epcPayload({ name: 'X', iban: 'DE00' }); return false; } catch { return true; } })());
  ok('EPC rejects 001 without BIC', (() => { try { epcPayload({ version: '001', name: 'X', iban: 'DE89370400440532013000' }); return false; } catch { return true; } })());

  // --- Stripe encoding and signatures ----------------------------------------------------------------
  // HMAC vectors are cross-checked against node:crypto, an independent implementation, so a bug shared by signer and
  // verifier (both use stripeSign) cannot pass unnoticed. Rotation: the first v1 is wrong, the second right.
  eq('stripeEncode', stripeEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 2500, product_data: { name: 'Gift & thanks' } } }], metadata: { donation: 'd1' }, x: null }),
    'mode=payment&line_items[0][quantity]=1&line_items[0][price_data][currency]=eur&line_items[0][price_data][unit_amount]=2500&line_items[0][price_data][product_data][name]=Gift+%26+thanks&metadata[donation]=d1');
  eq('stripe form round trip', parseStripeForm(stripeEncode({ a: [{ b: 'x y' }, { b: 'z' }], c: { d: true } })), { a: [{ b: 'x y' }, { b: 'z' }], c: { d: 'true' } });
  eq('formEncode', formEncode({ grant_type: 'client_credentials', a: 'x y&z', n: null }), 'grant_type=client_credentials&a=x+y%26z');
  const payload = '{"id":"evt_test_webhook","object":"event","type":"checkout.session.completed"}';
  const secret = 'whsec_test_secret';
  const t = 1700000000;
  // Computed vector, checked against Node's HMAC.
  const sig = stripeSign(payload, secret, t);
  eq('stripe signature = node HMAC', sig, crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'));
  eq('stripe signature vector', stripeSign('{"a":1}', 'whsec_x', 1), crypto.createHmac('sha256', 'whsec_x').update('1.{"a":1}').digest('hex'));
  const header = stripeSignatureHeader(payload, secret, t);
  eq('stripe verify ok', verifyStripeSignature(payload, header, secret, { now: t + 10 }), { ok: true, t });
  eq('stripe verify tampered', verifyStripeSignature(payload.replace('completed', 'expired'), header, secret, { now: t }).reason, 'signature mismatch');
  eq('stripe verify wrong secret', verifyStripeSignature(payload, header, 'whsec_other', { now: t }).reason, 'signature mismatch');
  eq('stripe verify replay', verifyStripeSignature(payload, header, secret, { now: t + 301 }).reason, 'timestamp outside the tolerance');
  eq('stripe verify rotation', verifyStripeSignature(payload, `t=${t},v1=${'0'.repeat(64)},v1=${sig},v0=abc`, secret, { now: t }).ok, true);
  eq('stripe verify no header', verifyStripeSignature(payload, '', secret).ok, false);
  eq('stripe verify bytes', verifyStripeSignature(new TextEncoder().encode(payload), header, secret, { now: t }).ok, true);
  const sp = donationSessionParams({ amount: 25, currency: 'EUR', interval: 'once', name: 'Donation', successURL: 'https://x.test/thanks?d=1', cancelURL: 'https://x.test/', email: 'a@b.test', donation: 'd1', campaign: 'c1', locale: 'ka' });
  eq('session params once', [sp.mode, sp.submit_type, sp.line_items[0].price_data.unit_amount, sp.line_items[0].price_data.currency, sp.locale, sp.customer_email, sp.metadata], ['payment', 'donate', 2500, 'eur', 'auto', 'a@b.test', { donation: 'd1', campaign: 'c1' }]);
  const sm = donationSessionParams({ amount: 10, currency: 'USD', interval: 'month', successURL: 'https://x.test/t', cancelURL: 'https://x.test/', donation: 'd2', locale: 'de' });
  eq('session params monthly', [sm.mode, sm.submit_type, sm.line_items[0].price_data.recurring, sm.subscription_data.metadata.donation, sm.locale], ['subscription', undefined, { interval: 'month' }, 'd2', 'de']);
  eq('payment link prefill', paymentLinkURL('https://buy.stripe.com/test_abc', { ref: 'd1', email: 'a@b.test', locale: 'fr' }), 'https://buy.stripe.com/test_abc?client_reference_id=d1&prefilled_email=a%40b.test&locale=fr');
  eq('payment link http refused', paymentLinkURL('http://buy.stripe.com/x'), '');

  // --- clients against the mock providers ------------------------------------------------------------
  // One requester for both schemes (https: http), because the mock speaks plain HTTP on localhost.
  const rx = await receiver();
  const mock = await startMockProviders({ stripe: { webhookURL: rx.url + '/stripe' }, paypal: { webhookURL: rx.url + '/paypal' } });
  const request = nodeRequester({ http, https: http });
  try {
    // Stripe
    const st = stripeClient({ secretKey: 'sk_test_mock', request, api: mock.url + '/stripe' });
    const sess = await st.createCheckoutSession(sp, { idempotencyKey: 'd1' });
    ok('stripe session created', /^cs_test_/.test(sess.id) && sess.url.startsWith(mock.url), sess);
    eq('stripe session echo', [sess.mode, sess.amount_total, sess.currency, sess.metadata.donation, sess.client_reference_id], ['payment', 2500, 'eur', 'd1', 'd1']);
    const back = await get(sess.url);
    eq('stripe hosted page redirects to success', [back.status, back.location], [302, 'https://x.test/thanks?d=1']);
    const hook = rx.hits.find((x) => x.path === '/stripe');
    ok('stripe webhook delivered', !!hook);
    eq('stripe webhook signature verifies', verifyStripeSignature(hook.body, hook.headers['stripe-signature'], 'whsec_mock').ok, true);
    const ev = stripeEvent(JSON.parse(hook.body));
    eq('stripe event summary', [ev.kind, ev.donation, ev.amount, ev.currency, ev.email, !!ev.customer], ['paid', 'd1', 25, 'EUR', 'a@b.test', true]);
    const again = await st.retrieveCheckoutSession(sess.id);
    eq('stripe retrieve paid', again.payment_status, 'paid');
    const portal = await st.createPortalSession({ customer: again.customer, return_url: 'https://x.test/' });
    ok('stripe portal url', portal.url.includes(again.customer), portal);
    const subSess = await st.createCheckoutSession(sm);
    rx.hits.length = 0;
    await get(subSess.url);
    const kinds = rx.hits.map((x) => stripeEvent(JSON.parse(x.body))).map((e) => [e.kind, e.donation]);
    eq('stripe subscription events', kinds, [['paid', 'd2'], ['first', 'd2']]);
    const subId = mock.stripe.sessions.get(subSess.id).subscription;
    rx.hits.length = 0;
    await mock.stripe.renew(subId);
    const ren = stripeEvent(JSON.parse(rx.hits[0].body));
    eq('stripe renewal', [ren.kind, ren.subscription, ren.amount, ren.donation], ['renewal', subId, 10, 'd2']);
    await rejects('stripe minimum amount', st.createCheckoutSession(donationSessionParams({ amount: 0.2, currency: 'EUR', successURL: 'https://x.test/', cancelURL: 'https://x.test/' })), /at least/);
    await rejects('stripe bad key', stripeClient({ secretKey: 'sk_test_wrong', request, api: mock.url + '/stripe' }).createCheckoutSession(sp), /Invalid API Key/);

    // PayPal
    const pp = paypalClient({ clientId: 'mock-client', secret: 'mock-secret', api: mock.url + '/paypal', request });
    const tok1 = await pp.token();
    eq('paypal token cached', await pp.token(), tok1);
    const order = await pp.createOrder(donationOrder({ amount: 15, currency: 'EUR', donation: 'd3', campaign: 'c1', returnURL: 'https://x.test/api/return?d=d3', cancelURL: 'https://x.test/', locale: 'de' }), { requestId: 'd3' });
    const link = approveURL(order);
    ok('paypal order + payer-action link', order.status === 'PAYER_ACTION_REQUIRED' && link.startsWith(mock.url), order);
    await rejects('paypal capture before approval', pp.captureOrder(order.id), /UNPROCESSABLE_ENTITY|ORDER_NOT_APPROVED/);
    const appr = await get(link);
    ok('paypal approval returns', appr.location.startsWith('https://x.test/api/return?d=d3&token=' + order.id), appr);
    rx.hits.length = 0;
    const cap = orderCapture(await pp.captureOrder(order.id));
    eq('paypal capture', [cap.status, cap.captureStatus, cap.amount, cap.currency, cap.donation, cap.email], ['COMPLETED', 'COMPLETED', 15, 'EUR', 'd3', 'donor@example.test']);
    // The capture webhook is sent after the response (see mock.js); give it time to land.
    await new Promise((r) => setTimeout(r, 100));
    const phook = rx.hits.find((x) => x.path === '/paypal');
    ok('paypal webhook delivered', !!phook);
    const pev = JSON.parse(phook.body);
    eq('paypal webhook verified', await pp.verifyWebhook(phook.headers, pev, 'WH-MOCK'), { ok: true });
    eq('paypal webhook wrong id', (await pp.verifyWebhook(phook.headers, pev, 'WH-OTHER')).ok, false);
    eq('paypal webhook missing headers', (await pp.verifyWebhook({}, pev, 'WH-MOCK')).reason, 'missing PayPal transmission headers');
    eq('paypal event summary', (({ kind, donation, amount, currency }) => [kind, donation, amount, currency])(paypalEvent(pev)), ['paid', 'd3', 15, 'EUR']);
    const prod = await pp.createProduct({ name: 'Monthly donation' });
    const plan = await pp.createPlan({ product: prod.id, name: 'Monthly 5 EUR', amount: 5, currency: 'EUR' });
    const sub = await pp.createSubscription({ plan: plan.id, donation: 'd4', returnURL: 'https://x.test/r?d=d4', cancelURL: 'https://x.test/' });
    rx.hits.length = 0;
    const sret = await get(approveURL(sub));
    ok('paypal subscription approval returns', sret.location.includes('subscription_id=' + sub.id), sret);
    const sget = await pp.getSubscription(sub.id);
    eq('paypal subscription active', [sget.status, sget.custom_id, sget.billing_info.last_payment.amount.value], ['ACTIVE', 'd4', '5.00']);
    const sevs = rx.hits.map((x) => paypalEvent(JSON.parse(x.body))).map((e) => [e.kind, e.subscription === sub.id]);
    eq('paypal subscription events', sevs, [['activated', true], ['paid', true]]);
    await rejects('paypal bad credentials', paypalClient({ clientId: 'x', secret: 'y', api: mock.url + '/paypal', request }).token(), /Client Authentication failed/);
    eq('paypal donate hosted', paypalDonateURL({ hostedId: 'ABC123', locale: 'fr' }), 'https://www.paypal.com/donate?hosted_button_id=ABC123&locale.x=fr_FR');
    eq('paypal donate business', paypalDonateURL({ business: 'fund@example.test', amount: 20, currency: 'EUR', item: 'Library roof', sandbox: true }),
      'https://www.sandbox.paypal.com/donate?business=fund%40example.test&amount=20.00&currency_code=EUR&item_name=Library+roof');
    eq('paypal.me', [paypalMeURL('ExampleFund', 10, 'EUR'), paypalMeURL('https://paypal.me/ExampleFund'), paypalMeURL('bad name')], ['https://paypal.me/ExampleFund/10.00EUR', 'https://paypal.me/ExampleFund', '']);

    // TBC
    const tbc = tbcClient({ apiKey: 'mock-apikey', clientId: 'mock-tbc-client', clientSecret: 'mock-tbc-secret', api: mock.url + '/tbc', request });
    const body = donationPayment({ amount: 30, currency: 'GEL', donation: 'd5', returnURL: 'https://x.test/api/return/tbc?d=d5', callbackURL: rx.url + '/tbc', lang: 'ka', methods: [5, 7, 99] });
    eq('tbc payment body', [body.amount, body.language, body.methods, body.merchantPaymentId, body.preAuth], [{ currency: 'GEL', total: 30, subTotal: 0, tax: 0, shipping: 0 }, 'KA', [5, 7], 'd5', false]);
    const pay = await tbc.createPayment(body);
    const appro = approvalURL(pay);
    ok('tbc payment created', pay.status === 'Created' && /^tpay-/.test(pay.payId) && appro.startsWith(mock.url), pay);
    eq('tbc token request was form-encoded', mock.log.find((x) => x.provider === 'tbc' && x.path === '/v1/tpay/access-token').body, { client_id: 'mock-tbc-client' });
    rx.hits.length = 0;
    const tret = await get(appro);
    eq('tbc checkout returns', tret.location, 'https://x.test/api/return/tbc?d=d5');
    const cb = rx.hits.find((x) => x.path === '/tbc');
    eq('tbc callback carries PaymentId', callbackPaymentId(cb.body, cb.headers['content-type']), pay.payId);
    const det = await tbc.getPayment(pay.payId);
    eq('tbc status', [det.status, tbcState(det.status), det.amount, det.currency], ['Succeeded', 'succeeded', 30, 'GEL']);
    const p2 = await tbc.createPayment(donationPayment({ amount: 10, currency: 'GEL', donation: 'd6', returnURL: 'https://x.test/r', saveCard: true }));
    await get(approvalURL(p2));
    const d2 = await tbc.getPayment(p2.payId);
    ok('tbc saved card', d2.recurringCard && /^rec-/.test(d2.recurringCard.recId), d2);
    const ex = await tbc.executeRecurring({ recId: d2.recurringCard.recId, amount: 10, currency: 'GEL', donation: 'd7' });
    eq('tbc recurring execution', [ex.status, ex.amount], ['Succeeded', 10]);
    const p3 = await tbc.createPayment(donationPayment({ amount: 5, currency: 'GEL', donation: 'd8', returnURL: 'https://x.test/r' }));
    await get(approvalURL(p3) + '?fail=1');
    eq('tbc failed', tbcState((await tbc.getPayment(p3.payId)).status), 'failed');
    await rejects('tbc wrong api key', tbcClient({ apiKey: 'nope', clientId: 'a', clientSecret: 'b', api: mock.url + '/tbc', request }).token(), /Invalid Api Key/);
    await rejects('tbc wrong secret', tbcClient({ apiKey: 'mock-apikey', clientId: 'mock-tbc-client', clientSecret: 'x', api: mock.url + '/tbc', request }).token(), /invalid client_id/);
    await rejects('tbc currency', tbc.createPayment(donationPayment({ amount: 5, currency: 'GBP', donation: 'd9', returnURL: 'https://x.test/r' })), /TBC/);
    eq('tbc states', ['Created', 'Processing', 'Expired', 'Returned', 'WaitingConfirm'].map(tbcState), ['pending', 'pending', 'expired', 'refunded', 'pending']);
    eq('tbc callback forms', [callbackPaymentId('PaymentId=abc-1', 'application/x-www-form-urlencoded'), callbackPaymentId('{"PaymentId":"x y"}', 'application/json')], ['abc-1', '']);
    // Timeouts surface as errors with code ETIMEDOUT.
    // A server that accepts and never answers: the only way to exercise the idle timeout path deterministically.
    const slow = http.createServer(() => {});
    await new Promise((r) => slow.listen(0, '127.0.0.1', r));
    await rejects('http timeout', request({ url: `http://127.0.0.1:${slow.address().port}/`, timeout: 200 }), /timed out/);
    slow.close();
    if (slow.closeAllConnections) slow.closeAllConnections();
  } catch (e) {
    fail++;
    console.log('FAIL payments clients: ' + (e && e.stack || e));
  } finally {
    await mock.close();
    await rx.close();
  }

  console.log(`payments: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
