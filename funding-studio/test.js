// funding-studio/test.js - tests of Funding Studio: `node funding-studio/test.js` (also `node check.js tests
// funding-studio`; importing the module runs nothing).
//   chains: EIP-55 vectors of the EIP, the stablecoin contracts' checksums, EIP-681 examples of the EIP, BIP-21 examples
//     of the BIP, BIP-173 / BIP-350 address vectors, base units, the derivation gap
//   runtime: the page's QR encoder equals qr/qr.js; units and exchange rates of the payment runtime
//   model and exports: hostile input, templates (fictional, no payment details), every export mode, static fallback,
//     no secret ever in a page
//   backend (real HTTP against payments/mock.js and mock-chains.js; no real provider or network): admin auth and
//     masked settings, publishing, served pages, Stripe checkout + signed webhook updating the goal, monthly renewal
//     and the customer portal, tampered webhooks, PayPal capture and subscription, TBC payment and callback in GEL,
//     Bitcoin address and Esplora detection, Ethereum claim with a USDC transfer, donor wall moderation, manual entries,
//     receipts, CSV / JSON export, persistence
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrMatrix } from '../qr/qr.js';
import { startMockProviders } from '../payments/mock.js';
import { stripeSignatureHeader } from '../payments/stripe.js';
import * as C from './chains.js';
import * as BTC_ACCOUNT from '../bitcoin/account.js';
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeed } from '../hdkey/bip39.js';

// BIP-84 test vectors (the BIP's own: mnemonic, account 0 zpub, first two receive addresses).
const BIP84 = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  zpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
  receive: ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'],
  testReceive0: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', // m/84'/1'/0'/0/0
};
// (Imports after a declaration are legal: ES module imports are hoisted and evaluated before any statement runs.)
// Testing approach: published vectors from the standards (EIP-55/681, BIP-21/84/173/350) for the crypto layer; the
// backend is exercised over real HTTP against local mock providers, so routing, raw-body signature checks and status
// transitions are tested exactly as deployed, without network access or real credentials.
import * as V from './viewer.js';
import { TEMPLATES } from './templates.js';
import { rtQr } from './runtime-qr.js';
import { rtPrice } from './runtime-pay.js';
import { buildSite } from './site.js';
import backend, { normSettings } from './backend.js';
import { startMockChains } from './mock-chains.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const runFeature = (fn, R) => { (new Function('return ' + fn.toString())())(R); return R; };

export function memoryStorage() {
  const m = new Map();
  return {
    read: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    write: (k, v) => { m.set(k, JSON.stringify(v)); },
    list: (p = '') => [...m.keys()].filter((k) => k.startsWith(p)),
    remove: (k) => m.delete(k),
    map: m,
  };
}

function call(base, method, p, { body, token, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(u, { method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let j = null;
        if (!raw) { try { j = JSON.parse(text); } catch { j = null; } }
        resolve({ status: res.statusCode, headers: res.headers, text, json: j });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

export async function startBackend(storage = memoryStorage()) {
  const logs = [];
  const be = backend({ dataDir: '', storage, log: (...a) => logs.push(a.join(' ')), name: 'funding-studio', node: { http, https, dns, net, zlib } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (!(await be.handle(req, res, url))) { res.writeHead(404); res.end('static'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const token = logs.map((l) => /admin token (\S+)/.exec(l)).find(Boolean)[1];
  return { be, base, token, storage, logs, close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }) };
}

export async function run() {
  V.activateProduct(); // other document products may have been loaded into this process (node check.js)
  let pass = 0, fail = 0;
  const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x));
  const eq = (name, got, want) => {
    if (J(got) === J(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${J(got)}\n  want ${J(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info).slice(0, 600) : ''}`); } };

  // --- chains -------------------------------------------------------------------------------------------
  const EIP55 = ['0x52908400098527886E0F7030069857D2E4169EE7', '0x8617E340B3D01FA5F11F306F4090FD50E238070D', '0xde709f2102306220921060314715629080e2fb77',
    '0x27b1fdb04752bbc536007a920d24acb045561c26', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'];
  for (const a of EIP55) ok('EIP-55 vector ' + a, C.isEthAddress(a));
  for (const a of EIP55.slice(4)) eq('EIP-55 checksum ' + a, C.ethChecksum(a.toLowerCase()), a);
  ok('EIP-55 mixed case typo refused', !C.isEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'));
  for (const [sym, t] of Object.entries(C.TOKENS)) for (const [ch, a] of Object.entries(t.at)) eq(`token ${sym}@${ch} checksummed`, C.ethChecksum(a), a);
  eq('EIP-681 ETH example', C.parseEip681('ethereum:0xfb6916095ca1df60bb79Ce92cE3Ea74c37c5d359?value=2.014e18').value, 2014000000000000000n);
  const ex2 = C.parseEip681('ethereum:0x89205a3a3b2a69de6dbf7f01ed13b2108b2c43e7/transfer?address=0x8e23ee67d1332ad560396262c48ffbb01f93d052&uint256=1');
  eq('EIP-681 ERC-20 example (recipient checksummed)', [ex2.fn, ex2.to, ex2.units, ex2.chain], ['transfer', '0x8e23Ee67d1332aD560396262C48ffbB01F93D052', 1n, 1]);
  const u681 = C.eip681({ address: '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359', chain: 8453, value: C.toUnits('2.014', 18) });
  eq('EIP-681 build', u681, 'ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359@8453?value=2014000000000000000');
  eq('EIP-681 round trip', C.parseEip681(u681).value, 2014000000000000000n);
  eq('EIP-681 token build', C.eip681Token({ token: C.TOKENS.USDC.at[8453], chain: 8453, to: EIP55[4], units: C.toUnits(25, 6) }),
    'ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed&uint256=25000000');
  eq('ERC-20 transfer data', C.erc20TransferData('0x8e23ee67d1332ad560396262c48ffbb01f93d052', 1000000n),
    '0xa9059cbb0000000000000000000000008e23ee67d1332ad560396262c48ffbb01f93d05200000000000000000000000000000000000000000000000000000000000f4240');
  // BIP-21 examples (the BIP's illustrative address has no valid checksum: parsing is syntactic).
  eq('BIP-21 example 1', C.parseBip21('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?label=Luke-Jr'), { address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W', amount: null, label: 'Luke-Jr', message: '', params: {} });
  eq('BIP-21 example 2', C.parseBip21('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr').amount, '20.3');
  eq('BIP-21 example 3', C.parseBip21('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz').message, 'Donation for project xyz');
  eq('BIP-21 unknown req- refused', C.parseBip21('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999'), null);
  eq('BIP-21 unknown params kept', C.parseBip21('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?somethingyoudontunderstand=50&somethingelseyoudontget=999').params, { somethingyoudontunderstand: '50', somethingelseyoudontget: '999' });
  eq('BIP-21 build', C.bip21({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 20.3, label: 'Luke-Jr', message: 'Donation for project xyz' }),
    'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=20.3&label=Luke-Jr&message=Donation%20for%20project%20xyz');
  eq('BTC amount', [C.btcAmount(0.000416666666), C.btcAmount(1e-8), C.btcAmount(50)], ['0.00041667', '0.00000001', '50']);
  const addrs = {
    BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4: ['main', 'p2wpkh'], tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7: ['test', 'p2wsh'],
    bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0: ['main', 'p2tr'], '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy': ['main', 'p2sh'],
    '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2': ['main', 'p2pkh'], mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn: ['test', 'p2pkh'],
  };
  for (const [a, [n, t]] of Object.entries(addrs)) eq('BTC address ' + a, (({ ok: o, network, type }) => [o, network, type])(C.btcAddressInfo(a)), [true, n, t]);
  for (const a of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', 'BC1QW508d6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'hello']) ok('BTC address refused ' + a, !C.btcAddressInfo(a).ok);
  eq('units', [C.toUnits(25.5, 6), C.toUnits('0.1', 18), C.fromUnits(1500000n, 6), C.decimalText(1e-7), C.toUnits('1.0000005', 6)], [25500000n, 100000000000000000n, '1.5', '0.0000001', 1000001n]);
  // Not wired (yet, in this process): derivation refuses with CRYPTO_GAP. backend() wires it when it starts.
  if (!C.canDerive()) ok('derivation not wired', (() => { try { C.deriveBtcAddress(BIP84.zpub, 0); return false; } catch (e) { return e.code === C.CRYPTO_GAP; } })());
  eq('derivation spec checks', [C.derivationSpecProblem(''), C.derivationSpecProblem('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'), C.derivationSpecProblem('hello')], ['empty', 'private', 'format']);
  // Wired with bitcoin/account.js: the first receive addresses of the BIP-84 test account (mnemonic "abandon … about",
  // m/84'/0'/0') must be the BIP's own vectors, from the zpub and from the same account as an output descriptor.
  C.wireCrypto({ bitcoin: BTC_ACCOUNT });
  ok('derivation wired', C.canDerive());
  eq('BIP-84 zpub receive 0..1', [C.deriveBtcAddress(BIP84.zpub, 0), C.deriveBtcAddress(BIP84.zpub, 1)], BIP84.receive);
  const desc84 = BTC_ACCOUNT.Account.fromExtendedKey(BIP84.zpub).descriptor();
  eq('BIP-84 descriptor receive 0..1', [C.deriveBtcAddress(desc84, 0), C.deriveBtcAddress(desc84, 1)], BIP84.receive);
  eq('derived address rules', C.btcAddressInfo(BIP84.receive[0]), { ok: true, network: 'main', type: 'p2wpkh' });
  eq('derivation spec checks (wired)', [C.derivationSpecProblem(BIP84.zpub), C.derivationSpecProblem(desc84), C.derivationSpecProblem(BIP84.zpub, 'test'), C.derivationSpecProblem(BIP84.zpub.slice(0, -1) + (BIP84.zpub.endsWith('s') ? 't' : 's'))], ['', '', 'invalid', 'invalid']);
  ok('derivation: a key of another network is refused', (() => { try { C.deriveBtcAddress(BIP84.zpub, 0, 'test'); return false; } catch { return true; } })());
  // Testnet: the BIP-84 test account m/84'/1'/0' as a descriptor over its tpub; receive 0 is the BIP's testnet vector.
  const tpub = BTC_ACCOUNT.deriveAccount(HDKey.fromMasterSeed(mnemonicToSeed(BIP84.mnemonic)), { type: 'p2wpkh', network: 'testnet' }).xpub;
  const tAddr = C.deriveBtcAddress(`wpkh(${tpub}/0/*)`, 0, 'test');
  eq('BIP-84 testnet receive 0', [tAddr, C.btcAddressInfo(tAddr).network], [BIP84.testReceive0, 'test']);

  // --- runtime ------------------------------------------------------------------------------------------
  const R = runFeature(rtQr, {});
  const texts = ['', '0123456789', 'HELLO WORLD', 'BITCOIN:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4?AMOUNT=0.001', u681, 'Грузия · ქართული ✓', 'BCD\n002\n1\nSCT\n\nExample Fund\nDE89370400440532013000\nEUR12.5', 'x'.repeat(600), 'y'.repeat(1800)];
  for (const t of texts) eq('runtime QR = qr.js (' + t.slice(0, 20) + '…)', JSON.stringify(R.qrMatrix(t)), JSON.stringify(qrMatrix(t, 'M')));
  ok('runtime QR svg', /^<svg[^>]+viewBox="0 0 25 25"/.test(R.qr('hi', 'T')) && R.qr('a', '<x>').includes('&#60;x&#62;'));
  const RP = runFeature(rtPrice, { cfg: { pay: { rates: { fixed: { 'BTC:EUR': 60000, 'USD:EUR': 0.92, 'EUR:GEL': 3 } } } } });
  eq('runtime units', [RP.units(25.5, 6), RP.units('0.1', 18), RP.units(1e-7, 8), RP.unitsText(RP.units(0.00041666, 8), 8)], [25500000n, 100000000000000000n, 10n, '0.00041666']);
  eq('runtime prices', [await RP.price('BTC', 'EUR'), await RP.price('EUR', 'EUR'), Math.round((await RP.price('USD', 'GEL')) * 1000) / 1000, await RP.price('ETH', 'EUR')], [60000, 1, 2.76, null]);

  // --- model and exports --------------------------------------------------------------------------------
  const hostile = V.normalizeDoc({ format: 'x', regions: { main: [{ type: 'hero', title: { en: '<img src=x onerror=alert(1)>' } }, { type: 'nope' }, 'junk'] }, pay: { stripe: { secretKey: 'sk_live_x', any: 'javascript:alert(1)', pk: 'sk_live_abc' }, bank: { iban: 'DE00 1234' }, btc: { address: 'bc1qbad' }, eth: { address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD' } } });
  eq('hostile: pages wrapped', hostile.regions.main.map((p) => [p.type, p.kind, p.blocks.map((b) => b.type)]), [['campaign', 'campaign', ['hero']]]);
  eq('hostile: payment data dropped', [hostile.pay.stripe.any, hostile.pay.stripe.pk, hostile.pay.bank.iban, hostile.pay.btc.address, hostile.pay.eth.address, 'secretKey' in hostile.pay.stripe], ['', '', '', '', '', false]);
  const h1 = await V.exportHTML(hostile, { mode: 'clean' });
  ok('hostile: no script injection', !h1.html.includes('<img src=x onerror'), h1.html.slice(0, 200));
  for (const [v, want] of [['paypal.me/LanternTable', 'LanternTable'], ['https://www.paypal.me/Ab12/25EUR', 'Ab12'], ['Ab12', 'Ab12'], ['paypal.me/bad name', '']]) eq('paypal.me name ' + v, V.paypalMeName(v), want);
  for (const tp of TEMPLATES) {
    const doc = tp.userLang ? tp.build(V, 'ka', { name: 'Blank' }) : tp.build(V);
    const n = V.normalizeDoc(doc);
    ok(`template ${tp.id}: pages`, V.livePages(n).length >= 2 && V.livePages(n).some((p) => p.kind === 'thanks'));
    ok(`template ${tp.id}: no payment details`, !V.METHODS.some((m) => V.methodReady(n, m)), n.pay);
    const r = await V.exportHTML(n, { mode: 'clean' });
    ok(`template ${tp.id}: export`, r.bytes > 20000 && r.report.types.includes('donate'), r.report);
    const site = await buildSite(n, { mode: 'clean' });
    ok(`template ${tp.id}: static site`, site.files.length === V.livePages(n).length && site.files[0].name === 'index.html' && site.files.slice(1).every((f) => /^[a-z0-9-]+\/index\.html$/.test(f.name)));
    eq(`template ${tp.id}: name of every language`, Object.keys(tp.name).sort(), ['de', 'en', 'es', 'fr', 'ka', 'ru', 'uk']);
  }
  // A configured page: static fallback, runtime configuration, nothing secret.
  const cdoc = TEMPLATES[0].build(V);
  cdoc.pay.bank = { ...cdoc.pay.bank, iban: 'DE89370400440532013000', holder: 'Example Fund', epc: true };
  cdoc.pay.stripe.any = 'https://buy.stripe.com/test_00example';
  cdoc.pay.btc.address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  cdoc.pay.eth.address = EIP55[4];
  const cp = await V.exportHTML(V.normalizeDoc(cdoc), { mode: 'clean' });
  ok('configured page: static fallback', cp.html.includes('DE89 3704 0044 0532 0130 00') && cp.html.includes('bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4') && cp.html.includes('buy.stripe.com/test_00example'));
  ok('configured page: features', ['donate', 'm-stripe', 'm-bank', 'm-btc', 'm-eth', 'qr', 'pages'].every((f) => cp.report.features.includes(f)), cp.report.features);
  const cpa = await V.exportHTML(V.normalizeDoc(cdoc), { mode: 'clean', api: { base: 'https://donate.example.test/', site: cdoc.id } });
  ok('page with backend: api config', cpa.html.includes('"api":{"base":"https://donate.example.test/"') && cpa.report.features.includes('api'));

  // --- backend -------------------------------------------------------------------------------------------
  const mock = await startMockProviders();
  const chains = await startMockChains();
  const storage = memoryStorage();
  let S = await startBackend(storage);
  try {
    eq('admin without token', (await call(S.base, 'GET', 'api/admin/overview')).status, 401);
    const settings = {
      stripe: { secretKey: 'sk_test_mock', webhookSecret: 'whsec_mock', api: mock.url + '/stripe' },
      paypal: { clientId: 'mock-client', secret: 'mock-secret', webhookId: 'WH-MOCK', sandbox: true, api: mock.url + '/paypal' },
      tbc: { apiKey: 'mock-apikey', clientId: 'mock-tbc-client', clientSecret: 'mock-tbc-secret', api: mock.url + '/tbc' },
      btc: { esplora: chains.esplora, addresses: ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'], confirmations: 1 },
      eth: { rpc: { 8453: chains.rpc }, confirmations: 1 },
      rates: { 'BTC:EUR': 60000, 'USD:EUR': 0.9, 'EUR:GEL': 3 },
    };
    const st = await call(S.base, 'PUT', 'api/admin/settings', { token: S.token, body: settings });
    ok('settings saved and masked', st.status === 200 && st.json.stripe.secretKey.startsWith('••••') && !st.text.includes('sk_test_mock') && !st.text.includes('mock-tbc-secret') && st.json.secretsSet['paypal.secret'], st.json);
    const st2 = await call(S.base, 'PUT', 'api/admin/settings', { token: S.token, body: { ...st.json, wall: 'review' } });
    eq('masked secrets are kept', [S.be.settings.stripe.secretKey, S.be.settings.tbc.clientSecret, st2.status], ['sk_test_mock', 'mock-tbc-secret', 200]);
    mock.config.stripe.webhookURL = S.base + 'api/webhooks/stripe';
    mock.config.paypal.webhookURL = S.base + 'api/webhooks/paypal';
    // Publish two sites: the charity (EUR) and the school (GEL).
    const charity = V.normalizeDoc(cdoc);
    const pub = await call(S.base, 'PUT', 'api/admin/sites/' + charity.id, { token: S.token, body: { doc: charity } });
    ok('publish', pub.status === 200 && pub.json.pages.length === 3, pub.json);
    const school = TEMPLATES.find((t) => t.id === 'school').build(V);
    const pub2 = await call(S.base, 'PUT', 'api/admin/sites/' + school.id, { token: S.token, body: { doc: school } });
    const home = await call(S.base, 'GET', pub.json.url, { raw: true });
    ok('served page', home.status === 200 && home.text.includes('Lantern Table') && home.text.includes('"api":{"base":"../../"') && !home.text.includes('sk_test_mock') && !home.text.includes('whsec_mock'), home.text.slice(0, 300));
    eq('page redirects and 404', [(await call(S.base, 'GET', pub.json.pages[1].url.replace(/\/$/, ''), { raw: true })).status, (await call(S.base, 'GET', pub.json.url + 'nope/', { raw: true })).status], [302, 404]);
    const live0 = await call(S.base, 'GET', `api/sites/${charity.id}/live`);
    const c1 = V.campaignsOf(charity)[0];
    eq('live: methods', live0.json.methods, { stripe: true, paypal: true, tbc: true, btc: true, eth: true });
    eq('live: CORS', live0.headers['access-control-allow-origin'], '*');
    const donate = (m, extra = {}) => call(S.base, 'POST', 'api/checkout', { body: { site: charity.id, campaign: c1.id, method: m, amount: 25, currency: 'EUR', interval: 'once', donor: { name: 'Ada Example', email: 'ada@example.test', message: 'For the cooks', wall: true }, lang: 'en', thanks: S.base + 's/x/thanks/', ...extra } });
    // Stripe one-time: checkout, hosted page, signed webhook.
    const so = await donate('stripe');
    ok('stripe checkout', so.status === 200 && so.json.url.startsWith(mock.url + '/stripe/pay/'), so.json);
    const sess = [...mock.stripe.sessions.values()].pop();
    eq('stripe session params', [sess.mode, sess.amount_total, sess.currency, sess.metadata.donation, sess.submit_type, sess.success_url.includes('d=' + so.json.id)], ['payment', 2500, 'eur', so.json.id, 'donate', true]);
    const back1 = await call(mock.url, 'GET', so.json.url.slice(mock.url.length), { raw: true });
    ok('stripe returns to thank-you', back1.status === 302 && back1.headers.location.includes('k=' + so.json.key));
    const sd = await call(S.base, 'GET', `api/donations/${so.json.id}?k=${so.json.key}`);
    ok('stripe donation succeeded', sd.json.status === 'succeeded' && sd.json.receipt, sd.json);
    eq('donation with a wrong key', (await call(S.base, 'GET', `api/donations/${so.json.id}?k=nope`)).status, 404);
    const live1 = await call(S.base, 'GET', `api/sites/${charity.id}/live`);
    eq('goal updated by the webhook', [live1.json.camps[c1.id].raised, live1.json.camps[c1.id].donors], [25, 1]);
    eq('wall waits for moderation', live1.json.camps[c1.id].wall.length, 0);
    const rc = await call(S.base, 'GET', `api/receipts/${so.json.id}?k=${so.json.key}&download=1`, { raw: true });
    ok('receipt', rc.status === 200 && /attachment; filename="receipt-R-\d{4}-00001\.html"/.test(rc.headers['content-disposition']) && rc.text.includes('Ada Example') && rc.text.includes('Lantern Table'), rc.headers);
    // Tampered and replayed webhooks.
    const evBody = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', amount_total: 900000, currency: 'eur', metadata: { donation: so.json.id } } } });
    eq('forged webhook refused', (await call(S.base, 'POST', 'api/webhooks/stripe', { body: evBody, headers: { 'Stripe-Signature': stripeSignatureHeader(evBody, 'whsec_other') } })).status, 400);
    const firstEv = mock.stripe.events[0];
    const replay = await call(S.base, 'POST', 'api/webhooks/stripe', { body: JSON.stringify(firstEv), headers: { 'Stripe-Signature': stripeSignatureHeader(JSON.stringify(firstEv), 'whsec_mock') } });
    ok('replayed event is ignored', replay.status === 200 && replay.json.duplicate);
    // Stripe monthly, renewal, portal.
    const sm = await donate('stripe', { interval: 'month', amount: 10 });
    await call(mock.url, 'GET', sm.json.url.slice(mock.url.length), { raw: true });
    const subs = (await call(S.base, 'GET', 'api/admin/recurring', { token: S.token })).json;
    ok('stripe subscription recorded', subs.length === 1 && subs[0].provider === 'stripe' && subs[0].status === 'active', subs);
    await mock.stripe.renew(subs[0].ref);
    const live2 = await call(S.base, 'GET', `api/sites/${charity.id}/live`);
    eq('renewal counted, donors not', [live2.json.camps[c1.id].raised, live2.json.camps[c1.id].donors], [45, 2]);
    const portal = await call(S.base, 'POST', 'api/portal', { body: { id: sm.json.id, key: sm.json.key } });
    ok('customer portal', portal.status === 200 && portal.json.url.includes('/stripe/portal/cus_'), portal.json);
    // PayPal one-time.
    const po = await donate('paypal');
    ok('paypal checkout', po.status === 200 && po.json.url.startsWith(mock.url + '/paypal/checkoutnow'), po.json);
    const appr = await call(mock.url, 'GET', po.json.url.slice(mock.url.length), { raw: true });
    const ret = await call(S.base, 'GET', appr.headers.location.slice(S.base.length), { raw: true });
    ok('paypal return captures', ret.status === 302 && ret.headers.location.includes('d=' + po.json.id), ret.headers);
    await new Promise((r) => setTimeout(r, 150));
    eq('paypal succeeded', (await call(S.base, 'GET', `api/donations/${po.json.id}?k=${po.json.key}`)).json.status, 'succeeded');
    // PayPal monthly.
    const pm = await donate('paypal', { interval: 'month', amount: 5 });
    const sappr = await call(mock.url, 'GET', pm.json.url.slice(mock.url.length), { raw: true });
    await call(S.base, 'GET', sappr.headers.location.slice(S.base.length), { raw: true });
    eq('paypal subscription', (await call(S.base, 'GET', `api/donations/${pm.json.id}?k=${pm.json.key}`)).json.status, 'succeeded');
    eq('paypal: GEL refused', (await donate('paypal', { currency: 'GEL' })).status, 400);
    // TBC in GEL (school site).
    const sc = V.campaignsOf(V.normalizeDoc(school))[0];
    const tb = await call(S.base, 'POST', 'api/checkout', { body: { site: school.id, campaign: sc.id, method: 'tbc', amount: 50, currency: 'GEL', interval: 'once', donor: {}, lang: 'ka' } });
    ok('tbc checkout', tb.status === 200 && tb.json.url.startsWith(mock.url + '/tbc/checkout/'), tb.json);
    const tpay = [...mock.tbc.payments.values()].pop();
    eq('tbc payment body', [tpay.amount, tpay.currency, tpay.callbackUrl === S.base + 'api/callbacks/tbc'], [50, 'GEL', true]);
    const tret = await call(mock.url, 'GET', tb.json.url.slice(mock.url.length), { raw: true });
    ok('tbc returns through the backend', tret.headers.location.startsWith(S.base + 'api/return/tbc'));
    const tback = await call(S.base, 'GET', tret.headers.location.slice(S.base.length), { raw: true });
    ok('tbc thank-you inside the site', tback.status === 302 && tback.headers.location.includes('/s/' + pub2.json.slug + '/thanks/'), tback.headers);
    eq('tbc succeeded', (await call(S.base, 'GET', `api/donations/${tb.json.id}?k=${tb.json.key}`)).json.status, 'succeeded');
    eq('tbc unknown callback', (await call(S.base, 'POST', 'api/callbacks/tbc', { body: { PaymentId: 'nope' } })).json.unknown, true);
    // Bitcoin: per-donation address from the pool, Esplora detection.
    const bt = await call(S.base, 'POST', 'api/btc/address', { body: { site: charity.id, campaign: c1.id, amount: 30, currency: 'EUR', donor: {} } });
    eq('btc address', [bt.status, bt.json.btc, bt.json.uri.startsWith('bitcoin:' + bt.json.address + '?amount=0.0005')], [200, '0.0005', true]);
    const bt2 = await call(S.base, 'POST', 'api/btc/address', { body: { site: charity.id, campaign: c1.id, amount: 30, currency: 'EUR', donor: {} } });
    ok('btc: next donation gets another address', bt2.json.address && bt2.json.address !== bt.json.address);
    eq('btc: pool exhausted', (await call(S.base, 'POST', 'api/btc/address', { body: { site: charity.id, campaign: c1.id, amount: 30, currency: 'EUR', donor: {} } })).status, 409);
    chains.payBtc(bt.json.address, 50000);
    const scan = await call(S.base, 'POST', 'api/admin/scan', { token: S.token });
    ok('scan', scan.status === 200 && scan.json.btc >= 1, scan.json);
    eq('btc detected', (await call(S.base, 'GET', `api/donations/${bt.json.id}?k=${bt.json.key}`)).json.status, 'succeeded');
    // Bitcoin from the owner's zpub: each donation gets the next receive address of the account (BIP-84 vectors).
    eq('btc xpub refused when invalid', [(await call(S.base, 'PUT', 'api/admin/settings', { token: S.token, body: { btc: { xpub: BIP84.zpub.slice(0, -2) + 'zz' } } })).status,
      (await call(S.base, 'PUT', 'api/admin/settings', { token: S.token, body: { btc: { xpub: BIP84.zpub, network: 'test' } } })).status], [400, 400]);
    eq('btc xpub saved', (await call(S.base, 'PUT', 'api/admin/settings', { token: S.token, body: { btc: { xpub: BIP84.zpub, network: 'main' } } })).status, 200);
    const dx = [];
    for (let i = 0; i < 2; i++) dx.push((await call(S.base, 'POST', 'api/btc/address', { body: { site: charity.id, campaign: c1.id, amount: 30, currency: 'EUR', donor: {} } })).json);
    eq('btc derived addresses', dx.map((x) => x.address), BIP84.receive);
    chains.payBtc(dx[1].address, 50000);
    await call(S.base, 'POST', 'api/admin/scan', { token: S.token });
    eq('btc derived address detected', (await call(S.base, 'GET', `api/donations/${dx[1].id}?k=${dx[1].key}`)).json.status, 'succeeded');
    // Ethereum: a USDC transfer on Base claimed by the page.
    const usdc = C.TOKENS.USDC.at[8453];
    const hash = chains.payToken({ token: usdc, to: charity.pay.eth.address, units: 20000000n });
    const claim = await call(S.base, 'POST', 'api/eth/claim', { body: { site: charity.id, campaign: c1.id, chain: 8453, token: 'USDC', tx: hash, amount: 18, currency: 'EUR', donor: {} } });
    ok('eth claim', claim.status === 200 && claim.json.id, claim.json);
    await new Promise((r) => setTimeout(r, 150));
    const ed = (await call(S.base, 'GET', `api/donations/${claim.json.id}?k=${claim.json.key}`)).json;
    eq('eth verified (20 USDC at 0.9)', [ed.status, ed.amount, ed.currency], ['succeeded', 18, 'EUR']);
    const again = await call(S.base, 'POST', 'api/eth/claim', { body: { site: charity.id, campaign: c1.id, chain: 8453, token: 'USDC', tx: hash, amount: 18, currency: 'EUR', donor: {} } });
    eq('eth claim is idempotent', again.json.id, claim.json.id);
    const wrong = chains.payEth({ to: '0x' + '9'.repeat(40), wei: 10n ** 16n });
    const cw = await call(S.base, 'POST', 'api/eth/claim', { body: { site: charity.id, campaign: c1.id, chain: 8453, token: 'ETH', tx: wrong, amount: 18, currency: 'EUR', donor: {} } });
    await new Promise((r) => setTimeout(r, 150));
    eq('eth to another address fails', (await call(S.base, 'GET', `api/donations/${cw.json.id}?k=${cw.json.key}`)).json.status, 'failed');
    // Donor wall moderation, manual entries, exports.
    const pendingWall = (await call(S.base, 'GET', 'api/admin/donations?wall=pending', { token: S.token })).json;
    ok('wall queue', pendingWall.total >= 1 && pendingWall.items.every((d) => !('key' in d) || d.key === undefined), pendingWall.total);
    await call(S.base, 'PATCH', 'api/admin/donations/' + so.json.id, { token: S.token, body: { wall: 'approved' } });
    const live3 = await call(S.base, 'GET', `api/sites/${charity.id}/live`);
    eq('wall after approval', live3.json.camps[c1.id].wall.map((w) => [w.n, w.a, w.m]), [['Ada Example', 25, 'For the cooks']]);
    const man = await call(S.base, 'POST', 'api/admin/donations', { token: S.token, body: { site: charity.id, campaign: c1.id, method: 'bank', amount: 100, currency: 'EUR', donor: { name: 'Bank donor', wall: true } } });
    eq('manual entry', [man.status, man.json.status, man.json.wall], [200, 'succeeded', 'approved']);
    const csv = await call(S.base, 'GET', 'api/admin/export.csv?site=' + charity.id, { token: S.token, raw: true });
    ok('CSV export', csv.status === 200 && csv.text.startsWith('id,created,paidAt,status') && csv.text.includes('Ada Example') && !csv.text.includes(so.json.key), csv.text.slice(0, 200));
    const js = await call(S.base, 'GET', 'api/admin/export.json', { token: S.token });
    ok('JSON export', Array.isArray(js.json) && js.json.length >= 8 && js.json.every((d) => d.key === undefined));
    const ov = (await call(S.base, 'GET', 'api/admin/overview', { token: S.token })).json;
    const oc = ov.sites.find((x) => x.id === charity.id).campaigns.find((x) => x.id === c1.id);
    eq('overview totals (offline base + ledger)', oc.raised, c1.raised + 25 + 10 + 10 + 25 + 5 + 30 + 30 + 18 + 100); // btc: pool + derived
    eq('test credentials', [(await call(S.base, 'POST', 'api/admin/test/stripe', { token: S.token })).json.ok, (await call(S.base, 'POST', 'api/admin/test/paypal', { token: S.token })).json.ok, (await call(S.base, 'POST', 'api/admin/test/tbc', { token: S.token })).json.ok], [true, true, true]);
    // Persistence: a new backend on the same storage.
    await S.close();
    S = await startBackend(storage);
    const live4 = await call(S.base, 'GET', `api/sites/${charity.id}/live`);
    eq('ledger survives a restart', live4.json.camps[c1.id].raised, live3.json.camps[c1.id].raised + 100);
    const page2 = await call(S.base, 'GET', pub.json.url, { raw: true });
    ok('served page shows live figures', page2.text.includes('€11,493'), (page2.text.match(/data-fd-raised>[^<]*<[^>]*>[^<]*/g) || []).slice(0, 3));
    eq('settings survive', normSettings(storage.read('settings')).stripe.secretKey, 'sk_test_mock');
  } catch (e) {
    fail++;
    console.log('FAIL backend: ' + (e && e.stack || e));
  } finally {
    await S.close();
    await mock.close();
    await chains.close();
  }

  console.log(`funding-studio: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
