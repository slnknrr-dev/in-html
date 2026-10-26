// ethereum-wallet/e2e.js - browser scenario of the Ethereum wallet through its interface, against a mocked JSON-RPC
// endpoint of a local Anvil chain (31337; window.fetch is replaced inside the page, nothing leaves the machine):
// create the vault, choose the chain and the mock endpoint, create a wallet with the backup check, receive (address +
// QR), see the funded balance, add an ERC-20 token and see its balance, send ether (review, sign in the browser,
// broadcast: the posted raw transaction is checked to be type 2 for chain 31337), sign and export offline, open a
// fixture ERC-20 transfer in the explorer (decoded call and log), a block, the dashboard (gas chart), decode a raw
// transaction in Tools, sign and verify a personal message.
//   node check.js e2e http://127.0.0.1:<port>/ethereum-wallet/ ethereum-wallet/e2e.js --lang en [--mobile --size 390x844]
//   The offline single-file build runs the offline part: node check.js e2e <file> ethereum-wallet/e2e.js --lang en
// The function is serialized into the page (Function.prototype.toString): only browser globals. The fixture
// transaction is signed with Anvil's public development key #0 ("test test … junk"): worthless test data.

// Helpers: until() polls a predicate (80 ms) instead of fixed sleeps, so the scenario is as fast as the UI and tolerant
// of slow CI. setValue fires input+change because components listen to either. Buttons are found by visible text
// with --lang en forced, which also checks that the labels render.
export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(80); } return null; };
  const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const btn = (text, root = document) => $$('button', root).find((b) => b.textContent.trim().includes(text) && !b.disabled);
  const click = async (text, root) => { const b = await until(() => btn(text, root)); if (b) b.click(); return !!b; };
  const go = async (hash) => { location.hash = hash; await sleep(300); };
  const text = () => document.body.textContent;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason && e.reason.message)));
  const offline = !!(globalThis.IN_HTML_ARTIFACT && globalThis.IN_HTML_ARTIFACT.mode === 'offline');

  localStorage.setItem('ethw-ui', JSON.stringify('en'));

  // The mock answers each method from fixtures; unknown methods return -32601 like a real node, so an unexpected
  // call surfaces as a UI error. The fixture tx/receipt are consistent with FIX_RAW (same hash), letting the explorer
  // and the decoder be checked against one another.
  // --- the mocked JSON-RPC endpoint (Anvil, chain 31337) ---
  const RPC = 'https://mock.rpc.test';
  const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const DEV0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const DEV1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const FIX_RAW = '0x02f8b1827a6905843b9aca00847735940082fde8945fbdb2315678afecb367f032d93f642f64180aa380b844a9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c800000000000000000000000000000000000000000000000000000000000f4240c001a0ab5874d1c3351ee2267d5398577ab1863d3c80b1752b2f03737413989e6b57b6a035737ec2deef6044591694c6c18817a62cac342343fefe55ae1154c570a3c2b5';
  const FIX = '0xdd088ff5cf589f0fec7de0232d94e3ed3d48889f296ff18e4f52bb8f2d31f58e';
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const HEAD = 100;
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
  const blockHash = (n) => '0x' + 'b1'.repeat(28) + Number(n).toString(16).padStart(8, '0');
  const fixTx = { hash: FIX, from: DEV0, to: TOKEN, input: '0xa9059cbb' + word(BigInt(DEV1)) + word(1000000), value: '0x0', nonce: '0x5', gas: '0xfde8', type: '0x2', chainId: '0x7a69',
    maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00', gasPrice: '0x3b9aca00', blockNumber: hex(99), blockHash: blockHash(99), transactionIndex: '0x0', accessList: [],
    v: '0x1', yParity: '0x1', r: '0xab5874d1c3351ee2267d5398577ab1863d3c80b1752b2f03737413989e6b57b6', s: '0x35737ec2deef6044591694c6c18817a62cac342343fefe55ae1154c570a3c2b5' };
  const fixReceipt = { transactionHash: FIX, transactionIndex: '0x0', blockHash: blockHash(99), blockNumber: hex(99), from: DEV0, to: TOKEN, status: '0x1', type: '0x2', gasUsed: '0xc350', cumulativeGasUsed: '0xc350',
    effectiveGasPrice: '0x3b9aca00', contractAddress: null, logsBloom: '0x' + '00'.repeat(256),
    logs: [{ address: TOKEN, topics: [TRANSFER, pad(DEV0), pad(DEV1)], data: '0x' + word(1000000), blockNumber: hex(99), transactionHash: FIX, transactionIndex: '0x0', logIndex: '0x0', blockHash: blockHash(99), removed: false }] };
  const block = (n, full) => ({ number: hex(n), hash: blockHash(n), parentHash: blockHash(n - 1), timestamp: hex(1700000000 + n * 12), gasLimit: hex(30000000), gasUsed: hex(n === 99 ? 50000 : 15000000),
    baseFeePerGas: hex(1000000000 + n * 1000000), miner: DEV1, size: '0x400', transactions: n === 99 ? [full ? fixTx : FIX] : [], uncles: [] });
  const mock = { funded: null, posted: [], calls: [] };
  const STR = (s) => '0x' + word(32) + word(s.length) + [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0');
  const answer = (method, p) => {
    switch (method) {
      case 'eth_chainId': return '0x7a69';
      case 'net_version': return '31337';
      case 'web3_clientVersion': return 'anvil/v1.0.0 (mock)';
      case 'eth_blockNumber': return hex(HEAD);
      case 'eth_getBalance': return mock.funded && p[0].toLowerCase() === mock.funded.toLowerCase() ? '0x8ac7230489e80000' : '0x0';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_getCode': return p[0].toLowerCase() === TOKEN.toLowerCase() ? '0x6080604052' : '0x';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_estimateGas': return '0x5208';
      case 'eth_feeHistory': {
        const n = Number(p[0]);
        return { oldestBlock: hex(HEAD - n + 1), baseFeePerGas: Array.from({ length: n + 1 }, (_, i) => hex(1000000000 + (i % 7) * 50000000)), gasUsedRatio: Array.from({ length: n }, (_, i) => 0.3 + (i % 5) / 10),
          ...(p[2] && p[2].length ? { reward: Array.from({ length: n }, () => p[2].map((q) => hex(q * 20000000))) } : {}) };
      }
      case 'eth_call': {
        const d = p[0].data || p[0].input || '';
        if (d.startsWith('0x70a08231')) return '0x' + word(mock.funded && d.slice(-40).toLowerCase() === mock.funded.slice(2).toLowerCase() ? 1234500000 : 0);
        if (d === '0x95d89b41') return STR('TST');
        if (d === '0x06fdde03') return STR('Test Token');
        if (d === '0x313ce567') return '0x' + word(6);
        return '0x';
      }
      case 'eth_getBlockByNumber': { if (p[0] === 'pending') return null; const n = p[0] === 'latest' ? HEAD : Number(p[0]); return n <= HEAD ? block(n, p[1]) : null; }
      case 'eth_getBlockByHash': { const n = parseInt(p[0].slice(-8), 16); return p[0].startsWith('0x' + 'b1'.repeat(28)) ? block(n, p[1]) : null; }
      case 'eth_getTransactionByHash': return p[0].toLowerCase() === FIX ? fixTx : null;
      case 'eth_getTransactionReceipt': return p[0].toLowerCase() === FIX ? fixReceipt : null;
      case 'eth_getLogs': return [];
      case 'eth_sendRawTransaction': mock.posted.push(p[0]); return '0x' + 'cc'.repeat(32);
      default: throw Object.assign(new Error('method not found'), { code: -32601 });
    }
  };
  const one = (c) => { mock.calls.push(c.method); try { return { jsonrpc: '2.0', id: c.id, result: answer(c.method, c.params || []) }; } catch (e) { return { jsonrpc: '2.0', id: c.id, error: { code: e.code || -32000, message: e.message } }; } };
  const realFetch = window.fetch;
  window.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith(RPC)) return realFetch(url, opts);
    const body = JSON.parse(String(opts.body));
    const out = Array.isArray(body) ? body.map(one) : one(body);
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  // --- vault ---
  const pw = await until(() => { const l = $$('.wu-lock input[type=password]'); return l.length === 2 && l; });
  step('lock screen', !!pw, pw && pw.length);
  setValue(pw[0], 'e2e-Password-1234');
  setValue(pw[1], 'e2e-Password-1234');
  await click('Create the vault');
  const tabs = await until(() => $('.wu-tabs'), 60000);
  step('vault created', !!tabs, null);

  // --- chain and endpoint ---
  await go('#/settings');
  const chainSel = await until(() => $$('select').find((s) => [...s.options].some((o) => o.value === '31337')));
  setValue(chainSel, '31337');
  await sleep(300);
  step('chain Anvil', text().includes('JSON-RPC endpoint for Anvil') || (offline && text().includes('offline build')), null);
  if (!offline) {
    const url = await until(() => $('input[type=url]'));
    setValue(url, RPC);
    await click('Connect', url.parentElement);
    await click('Connect', await until(() => $('.ed-dialog')));
    const connected = await until(() => text().includes('mock.rpc.test') && text().includes('Connected: chain 31337'));
    step('endpoint chosen', !!connected, null);
  }
  const privacy = $('[data-privacy]');
  step('privacy statement', !!privacy && /never leave this browser/.test(privacy.textContent), null);

  // --- new wallet with the backup check ---
  await go('#/wallet');
  await click('New wallet');
  const words = (await until(() => $$('.wu-word').length === 12 && $$('.wu-word'))).map((w) => w.textContent);
  step('recovery phrase shown', words.length === 12, words.length);
  await click('I wrote it down');
  const dlg = await until(() => $('.wu-backup-dlg'));
  for (const inp of $$('input[data-index]', dlg)) setValue(inp, words[+inp.dataset.index]);
  await click('Check', dlg);
  const addrEl = await until(() => $('.wu-qr svg') && $('[data-address]'), 30000);
  const address = addrEl && addrEl.textContent.trim();
  step('receive address', /^0x[0-9a-fA-F]{40}$/.test(address || ''), address);
  step('receive QR', !!$('.wu-qr svg') && text().includes('ethereum:' + address), null);
  const walletId = location.hash.split('/')[2];

  if (!offline) {
    mock.funded = address;
    await go(`#/wallet/${walletId}`);
    await click('Refresh');
    const bal = await until(() => /^10 ETH$/.test((($('[data-balance]') || {}).textContent || '').trim()));
    step('balance', !!bal, ($('[data-balance]') || {}).textContent);

    // --- token ---
    await click('Add token');
    const tdlg = await until(() => $('.ew-token-dlg'));
    setValue($('input', tdlg), TOKEN);
    const found = await until(() => tdlg.textContent.includes('Found TST with 6 decimals'));
    step('token read from contract', !!found, null);
    await click('Add token', $('.ed-dialog-foot', tdlg) || tdlg);
    const tb = await until(() => { const el = $('[data-token-balance="TST"]'); return el && /1,234\.5 TST/.test(el.textContent) && el; });
    step('token balance', !!tb, tb && tb.textContent);

    // --- send ether ---
    await go(`#/wallet/${walletId}/send`);
    const to = await until(() => $('input[name=to]'));
    await until(() => ($('input[name=maxFee]') || {}).value);
    setValue(to, DEV1);
    setValue($('input[name=amount]'), '0.5');
    await click('Review');
    const signBtn = await until(() => btn('Sign and send'));
    step('review', !!signBtn && text().includes('Review the transaction') && text().includes('0.5 ETH'), null);
    if (signBtn) signBtn.click();
    const done = await until(() => $('[data-txhash]'), 20000);
    const raw = mock.posted[0] || '';
    // Raw tx layout check: 0x02 (type) f8.. (RLP list) then chain id 0x7a69 encoded as 82 7a 69 at hex offset 8.
  step('broadcast type-2 for chain 31337', !!done && raw.startsWith('0x02f8') && raw.slice(8, 14) === '827a69', raw.slice(0, 24));
    if (done) await click('Close', $('.ed-dialog'));
    await sleep(300);
  }

  // --- offline signing: every field by hand, signed transaction exported ---
  await go(`#/wallet/${walletId}/send`);
  const to2 = await until(() => $('input[name=to]'));
  setValue(to2, DEV1);
  setValue($('input[name=amount]'), '0.25');
  const custom = $$('.ed-seg-btn').find((b) => b.textContent.trim() === 'Custom');
  if (custom) custom.click();
  await sleep(100);
  setValue($('input[name=maxFee]'), '3');
  setValue($('input[name=priority]'), '1.5');
  setValue($('input[name=gasLimit]'), '21000');
  setValue($('input[name=nonce]'), '7');
  await click('Review');
  await click('Sign and export');
  const rawDlg = await until(() => $('.ew-raw-dlg textarea'));
  const signed = rawDlg ? rawDlg.value : '';
  step('signed offline and exported', signed.startsWith('0x02f8') && signed.slice(8, 14) === '827a69', signed.slice(0, 24));
  if (rawDlg) await click('Close', $('.ew-raw-dlg'));

  if (!offline) {
    // --- explorer ---
    await go(`#/explorer/tx/${FIX}`);
    const decoded = await until(() => text().includes('transfer(address,uint256)') && text().includes('Token transfers (1)') && text().includes('Logs (1)'));
    step('explorer transaction', !!decoded && text().includes('success') && text().includes('1 TST'), null);
    await go('#/explorer/block/99');
    const blk = await until(() => text().includes('Block 99') && $(`a[href="#/explorer/tx/${FIX}"]`));
    step('explorer block', !!blk, null);
    await go('#/explorer');
    const home = await until(() => text().includes('Latest blocks') && $$('a[href^="#/explorer/block/"]').length >= 5);
    step('explorer home', !!home, null);
    await go('#/dashboard');
    const dash = await until(() => text().includes('Base fee, last 50 blocks') && $$('.wu-chart svg').length >= 2 && text().includes('Average block time'));
    step('dashboard', !!dash, $$('.wu-chart svg').length);
  }

  // --- decoder (offline too) ---
  await go('#/tools/decode');
  const ta = await until(() => $('textarea'));
  setValue(ta, FIX_RAW);
  await click('Decode');
  const dec = await until(() => text().includes(DEV0) && text().includes('transfer(address,uint256)') && text().includes(FIX));
  step('decoder', !!dec, null);

  // --- message signing and verification ---
  await go(`#/wallet/${walletId}/sign`);
  const msgArea = await until(() => $$('textarea')[0]);
  setValue(msgArea, 'hello from e2e');
  await click('Sign');
  const sigArea = await until(() => $$('textarea').find((x) => x.readOnly && x.value.length === 132));
  step('message signed', !!sigArea, sigArea && sigArea.value.slice(0, 12));
  const vsec = $$('.wu-grid2 > section')[1];
  setValue($$('input', vsec)[0], address);
  setValue($$('textarea', vsec)[0], 'hello from e2e');
  setValue($$('textarea', vsec)[1], sigArea ? sigArea.value : '');
  await click('Verify', vsec);
  const ok = await until(() => text().includes('Valid signature by ' + address));
  step('message verified', !!ok, null);

  await go(`#/wallet/${walletId}`);
  await sleep(500);
  step('no page errors', errors.length === 0, errors.slice(0, 3));
  return { steps, rpcCalls: mock.calls.length, offline };
}
