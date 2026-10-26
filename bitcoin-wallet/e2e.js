// bitcoin-wallet/e2e.js - browser scenario of the Bitcoin wallet through its interface, against a mocked Esplora
// server (window.fetch is replaced inside the page; nothing leaves the machine): create the vault, choose testnet4 and
// the mock server, create a wallet with the backup check, receive (address + QR), synchronise a funded address, send
// (review, sign in the browser, broadcast: the posted transaction is checked), open a transaction (the BIP-143 example,
// its scripts verified by the interpreter) and a block (the genesis header) in the explorer, decode a raw transaction,
// sign and verify a message, look at the dashboard.
//   node check.js e2e http://127.0.0.1:<port>/bitcoin-wallet/ bitcoin-wallet/e2e.js [--mobile --size 390x844]
//   The offline single-file build runs the offline part: node check.js e2e <file> bitcoin-wallet/e2e.js
// The function is serialized into the page (Function.prototype.toString): only browser globals.
// Because the function is serialised, it cannot import helpers: the small DOM utilities are redefined inside.
// Buttons are found by visible English text (the UI is forced to English below): this also asserts the labels.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Polling with a deadline instead of fixed waits: crypto (vault key derivation, PBKDF2 for the seed) takes a
  // variable time per machine.
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(80); } return null; };
  const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const btn = (text, root = document) => $$('button', root).find((b) => b.textContent.trim().includes(text) && !b.disabled);
  const click = async (text, root) => { const b = await until(() => btn(text, root)); if (b) b.click(); return !!b; };
  const go = async (hash) => { location.hash = hash; await sleep(250); };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const offline = !!(globalThis.IN_HTML_ARTIFACT && globalThis.IN_HTML_ARTIFACT.mode === 'offline');

  // English UI.
  localStorage.setItem('btcw-ui', JSON.stringify('en'));

  // --- the mocked Esplora server ---
  // The page's own fetch is wrapped, so the real app code (bitcoin/esplora.js) runs unmodified; only requests to the
  // .test host (RFC 6761 reserved, never resolvable) are answered locally. Known vectors make results checkable:
  // the BIP-143 example transaction (its signatures must verify in the interpreter) and the genesis block header
  // (its hash must match the proof of work).
  const BIP143 = '01000000000102fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f00000000494830450221008b9d1dc26ba6a9cb62127b02742fa9d754cd3bebf337f7a55d114c8e5cdd30be022040529b194ba3f9281a99f2b1c0a19c0489bc22ede944ccf4ecbab4cc618ef3ed01eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac000247304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee0121025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee635711000000';
  const BIP143_ID = 'e8151a2af31c368a35053ddd4bdb285a8595c769a3ad83e0fa02314a602d4609';
  const GENESIS = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
  const GENESIS_ID = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
  const FUND_ID = 'aa'.repeat(32);
  const mock = { funded: null, posted: [], calls: [] };
  const realFetch = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://mock.esplora.test/api')) return realFetch(url, opts);
    const p = u.slice('https://mock.esplora.test/api'.length);
    mock.calls.push((opts.method || 'GET') + ' ' + p);
    const json = (v, status = 200) => new Response(typeof v === 'string' ? v : JSON.stringify(v), { status });
    const st = { confirmed: true, block_height: 100, block_hash: GENESIS_ID, block_time: 1700000000 };
    let m;
    if (p === '/blocks/tip/height') return json('105');
    if (p === '/fee-estimates') return json({ 1: 20.5, 2: 15, 3: 12, 6: 8, 144: 2, 1008: 1 });
    if (p === '/mempool') return json({ count: 1234, vsize: 2500000, total_fee: 5000000, fee_histogram: [[50, 100000], [20, 600000], [5, 1800000]] });
    if (p === '/mempool/recent') return json([]);
    if (p.startsWith('/blocks')) return json([{ id: GENESIS_ID, height: 100, timestamp: 1700000000, tx_count: 1, size: 285, weight: 1140, merkle_root: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', version: 1, bits: 486604799, nonce: 2083236893, difficulty: 1 }]);
    if ((m = /^\/address\/([^/]+)$/.exec(p))) {
      const funded = m[1] === mock.funded;
      return json({ address: m[1], chain_stats: { funded_txo_count: funded ? 1 : 0, funded_txo_sum: funded ? 100000 : 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: funded ? 1 : 0 }, mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } });
    }
    if ((m = /^\/address\/([^/]+)\/utxo$/.exec(p))) return json(m[1] === mock.funded ? [{ txid: FUND_ID, vout: 0, value: 100000, status: st }] : []);
    if ((m = /^\/address\/([^/]+)\/txs/.exec(p))) {
      if (m[1] !== mock.funded) return json([]);
      return json([{ txid: FUND_ID, status: st, fee: 200, weight: 561, size: 222, vin: [{ txid: 'bb'.repeat(32), vout: 0, sequence: 4294967293, prevout: { scriptpubkey: '0014' + '11'.repeat(20), value: 100200 } }], vout: [{ scriptpubkey: window.__fundedScript || '', value: 100000 }] }]);
    }
    if (p === '/tx' && opts.method === 'POST') { mock.posted.push(String(opts.body)); return json('cc'.repeat(32)); }
    if (p === `/tx/${BIP143_ID}`) return json({ txid: BIP143_ID, status: st, fee: 889210000, weight: 1042, vin: [{ prevout: { scriptpubkey: '2103c9f4836b9a4f77fc0d81f7bcb01b7f1b35916864b9476c241ce9fc198bd25432ac', value: 625000000 } }, { prevout: { scriptpubkey: '00141d0f172a0ecb48aee1be1f2687d2963ae33f71a1', value: 600000000 } }], vout: [] });
    if (p === `/tx/${BIP143_ID}/hex`) return json(BIP143);
    if (p === `/tx/${BIP143_ID}/outspends`) return json([{ spent: false }, { spent: true, txid: 'dd'.repeat(32), vin: 0 }]);
    if (p === '/block-height/0') return json(GENESIS_ID);
    if (p === `/block/${GENESIS_ID}`) return json({ id: GENESIS_ID, height: 0, timestamp: 1231006505, tx_count: 1, size: 285, weight: 1140, merkle_root: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', version: 1, bits: 486604799, nonce: 2083236893, difficulty: 1 });
    if (p === `/block/${GENESIS_ID}/header`) return json(GENESIS);
    if (p.startsWith(`/block/${GENESIS_ID}/txs`)) return json([{ txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', fee: 0, weight: 816, vin: [{ is_coinbase: true }], vout: [{ value: 5000000000 }] }]);
    return json('not found', 404);
  };

  // --- vault ---
  const pw = await until(() => $$('.wu-lock input[type=password]'));
  step('lock screen', pw && pw.length === 2, pw && pw.length);
  setValue(pw[0], 'e2e-Password-1234');
  setValue(pw[1], 'e2e-Password-1234');
  await click('Create the vault');
  // 60 s: creating the vault derives the encryption key with a deliberately slow KDF.
  const tabs = await until(() => $('.wu-tabs'), 60000);
  step('vault created', !!tabs, null);

  // --- network and server ---
  await go('#/settings');
  const netSel = await until(() => $$('select').find((s) => [...s.options].some((o) => o.value === 'testnet4')));
  setValue(netSel, 'testnet4');
  await sleep(300);
  if (!offline) {
    const url = await until(() => $('input[type=url]'));
    setValue(url, 'https://mock.esplora.test/api');
    await click('Connect', url.parentElement);
    await click('Connect', await until(() => $('.ed-dialog')));
    await sleep(600);
    step('server chosen', document.body.textContent.includes('mock.esplora.test'), null);
  }

  // --- new wallet with the backup check ---
  await go('#/wallet');
  await click('New wallet');
  const words = (await until(() => $$('.wu-word').length === 12 && $$('.wu-word'))).map((w) => w.textContent);
  step('recovery phrase shown', words.length === 12, words.length);
  await click('I wrote it down');
  const dlg = await until(() => $('.wu-backup-dlg'));
  // The backup check asks for random word positions (data-index); the test answers from the phrase it read.
  for (const inp of $$('input[data-index]', dlg)) setValue(inp, words[+inp.dataset.index]);
  await click('Check', dlg);
  const addrEl = await until(() => $('.wu-qr') && $('.wu-mono.wu-break.wu-center'), 30000);
  const address = addrEl && addrEl.textContent.trim();
  step('receive address', /^tb1q[a-z0-9]{38}$/.test(address || ''), address);
  step('receive QR', !!$('.wu-qr svg'), null);
  const walletId = location.hash.split('/')[2];

  if (!offline) {
    // Fund the first receive address in the mock and synchronise.
    // "Funding" = the mock starts reporting a UTXO for the wallet's first receive address.
    mock.funded = address;
    await go(`#/wallet/${walletId}`);
    await click('Refresh');
    const bal = await until(() => /0\.001\s*BTC/.test(($('.wu-amount') || {}).textContent || ''));
    step('balance', !!bal, ($('.wu-amount') || {}).textContent);

    // --- send ---
    await go(`#/wallet/${walletId}/send`);
    const to = await until(() => $('.wu-recipient input.wu-mono'));
    setValue(to, 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
    setValue($$('.wu-recipient input')[1], '0.0005');
    await click('Review');
    const signBtn = await until(() => btn('Sign and send'));
    step('review', !!signBtn && document.body.textContent.includes('Review the transaction'), null);
    signBtn.click();
    const done = await until(() => $('[data-txid]'), 20000);
    const raw = mock.posted[0] || '';
    // The broadcast body must be a version-2 transaction spending the funded outpoint: proves coin selection, signing
    // and serialisation produced a real transaction, not just that a POST happened.
    step('broadcast', !!done && raw.startsWith('02000000') && raw.includes(FUND_ID) && raw.length > 300, raw.slice(0, 40));
    if (done) await click('Close', $('.ed-dialog'));

    // --- explorer ---
    await go(`#/explorer/tx/${BIP143_ID}`);
    const verified = await until(() => $$('.wu-io-item .wu-ok').length === 2);
    step('explorer transaction', document.body.textContent.includes('Inputs (2)') && !!verified, $$('.wu-io-item').length);
    await go('#/explorer/block/0');
    const blk = await until(() => document.body.textContent.includes('hash and proof of work verified'));
    step('explorer block', !!blk, null);
    await go('#/dashboard');
    const dash = await until(() => $('.wu-chart svg') && document.body.textContent.includes('Fee market'));
    step('dashboard', !!dash, null);
  }

  // --- decoder (offline too) ---
  await go('#/tools/decode');
  const ta = await until(() => $('textarea'));
  setValue(ta, BIP143);
  await click('Decode');
  const dec = await until(() => document.body.textContent.includes('Outputs (2)'));
  step('decoder', !!dec, null);

  // --- message signing and verification ---
  await go(`#/wallet/${walletId}/sign`);
  const msgArea = await until(() => $$('textarea')[0]);
  setValue(msgArea, 'hello from e2e');
  await click('Sign');
  const sigArea = await until(() => $$('textarea').find((x) => x.readOnly && x.value.length > 60));
  step('message signed', !!sigArea, sigArea && sigArea.value.slice(0, 12));
  const inputs = $$('.wu-grid2 > section')[1];
  setValue($$('input', inputs)[0], address);
  setValue($$('textarea', inputs)[0], 'hello from e2e');
  setValue($$('textarea', inputs)[1], sigArea ? sigArea.value : '');
  await click('Verify', inputs);
  const ok = await until(() => document.body.textContent.includes('Valid signature'));
  step('message verified', !!ok, null);

  // Any uncaught page error fails the scenario even if every visible step passed.
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps, mockCalls: mock.calls.length };
}
