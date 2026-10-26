// ethereum/test.js - unit tests of the ethereum library: `node ethereum/test.js` (or `node check.js tests ethereum`).
// Never touches the network (fetch is mocked). Vector sources:
//   test-vectors.json: ethereum/tests RLPTests (rlptest.json, invalidRLPTest.json), KeyStoreTests/basic_tests.json
//     (test1 / test2 = the two vectors of the Web3 Secret Storage Definition), BasicTests/txtest.json,
//     ABITests/basic_abi_tests.json, TransactionTests/* (all 208 filled tests of the develop branch, Prague results:
//     hash, sender and intrinsic gas of the valid ones, rejection of the invalid ones).
//   In this file: BasicTests/keyaddrtest.json (seed -> key -> address); EIP-55 and EIP-1191 test cases; EIP-1014
//   CREATE2 examples 0-6; EIP-155 example (signing data, signing hash, v r s, signed transaction); EIP-712 Mail
//   example (eip-712.md and its assets Example.js: encodeType, typeHash, encodeData, hashStruct, domain separator,
//   final hash, signature with keccak256('cow')); ERC-2098 test cases; the Solidity ABI specification examples
//   (docs/abi-spec.rst: baz, bar, sam, f(uint,uint32[],bytes10,bytes), g(uint[][],string[]), encodePacked,
//   InsufficientBalance selector, the tuple JSON of f(S,T,uint)); ERC-137 namehash examples; EIP-681 examples;
//   ERC-165 / ERC-721 / ERC-1155 interface ids and the ERC-165 supportsInterface call data; EIP-1559 base fee rules.
//   Well-known public development keys: the Hardhat / Anvil accounts of "test test … junk" (never real funds).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { keccak256 } from '../crypto/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '../crypto/encoding.js';
import { CURVE, ecdsaSign } from '../crypto/secp256k1.js';
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeed } from '../hdkey/bip39.js';
import * as U from './units.js';
import { rlpDecode, rlpEncode, rlpToHex } from './rlp.js';
import * as A from './address.js';
import * as T from './tx.js';
import * as M from './message.js';
import * as ABI from './abi.js';
import * as E from './erc.js';
import * as K from './keystore.js';
import * as URI from './uri.js';
import * as ENS from './ens.js';
import * as RPC from './rpc.js';
import * as OFF from './rpc.offline.js';
import * as C from './chains.js';
import * as L from './logs.js';
import * as HD from './hd.js';
import * as F from './fees.js';

// Strategy: published vectors first (ethereum/tests, EIP texts), so a passing suite means interoperability with other
// clients, not only self-consistency (encode/decode round trips alone would pass with a symmetric bug).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// The official keystore vectors use their full KDF costs (seconds each): they run in worker threads started first, so
// they overlap with the rest of the suite (in this thread when workers are unavailable).
function decryptInWorker(json, password) {
  const src = `const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.url).then((K) => parentPort.postMessage({ key: Array.from(K.decryptKeystore(workerData.json, workerData.password)) }))
      .catch((e) => parentPort.postMessage({ error: String(e && e.message) }));`;
  return new Promise((resolve, reject) => {
    const w = new Worker(src, { eval: true, workerData: { url: new URL('./keystore.js', import.meta.url).href, json, password } });
    w.once('message', (m) => { w.terminate(); if (m.error) reject(new Error(m.error)); else resolve(Uint8Array.from(m.key)); });
    w.once('error', reject);
  });
}

const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x + 'n' : x instanceof Uint8Array ? 'bytes:' + bytesToHex(x) : x));
const h = (b) => '0x' + bytesToHex(b);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (J(got) === J(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${J(got)}\n  want ${J(want)}`); }
  };
  const throws = (name, fn, code) => {
    try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch (e) {
      if (code && e.code !== code) { fail++; console.log(`FAIL ${name}: code ${e.code}, want ${code} (${e.message})`); } else pass++;
    }
  };
  const rejects = async (name, promise, code) => {
    try { await promise; fail++; console.log(`FAIL ${name}: no error`); } catch (e) {
      if (code && e.code !== code) { fail++; console.log(`FAIL ${name}: code ${e.code}, want ${code} (${e.message})`); } else pass++;
    }
  };
  const V = JSON.parse(fs.readFileSync(path.join(HERE, 'test-vectors.json'), 'utf8'));
  const keystoreJobs = Object.entries(V.keystore).map(([name, v]) => {
    const p = (async () => { try { return await decryptInWorker(v.json, v.password); } catch { return K.decryptKeystore(v.json, v.password); } })();
    p.catch(() => {});
    return [name, v, p];
  });
  const counts = {};
  const count = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  // --- units ---------------------------------------------------------------------------------------------
  eq('parseEther', U.parseEther('1.5'), 1500000000000000000n);
  eq('parseUnits 6', U.parseUnits('123.456789', 6), 123456789n);
  eq('parseUnits trailing zeros', U.parseUnits('1.10000000', 2), 110n);
  eq('parseUnits .5', U.parseUnits('.5', 1), 5n);
  eq('parseUnits negative', U.parseUnits('-0.25', 2), -25n);
  eq('parseGwei', U.parseGwei('20'), 20000000000n);
  throws('parseUnits too many decimals', () => U.parseUnits('1.001', 2));
  throws('parseUnits garbage', () => U.parseUnits('1,5'));
  throws('parseUnits empty', () => U.parseUnits(''));
  throws('parseUnits exponent', () => U.parseUnits('1e18'));
  eq('formatEther', U.formatEther(1500000000000000000n), '1.5');
  eq('formatEther integer', U.formatEther(2n * 10n ** 18n), '2');
  eq('formatEther wei', U.formatEther(1n), '0.000000000000000001');
  eq('formatUnits maxDecimals cuts', U.formatUnits(1999999n, 6, { maxDecimals: 2 }), '1.99');
  eq('formatUnits group', U.formatUnits(1234567890123n, 3, { group: true }), '1,234,567,890.123');
  eq('formatUnits negative', U.formatUnits(-1050n, 3), '-1.05');
  eq('formatGwei', U.formatGwei(1500000000n), '1.5');
  eq('toQuantity', [U.toQuantity(0), U.toQuantity(255n), U.toQuantity(1024)], ['0x0', '0xff', '0x400']);
  eq('fromQuantity', [U.fromQuantity('0x0'), U.fromQuantity('0x00ff'), U.fromQuantity('0x')], [0n, 255n, 0n]);
  throws('toQuantity negative', () => U.toQuantity(-1n));
  throws('fromQuantity garbage', () => U.fromQuantity('12'));
  eq('toHex / fromHex', [U.toHex(Uint8Array.of(0, 171)), h(U.fromHex('0xABCD')), U.toHex('0xABCD')], ['0x00ab', '0xabcd', '0xabcd']);
  throws('fromHex odd', () => U.fromHex('0xabc'));

  // --- RLP (ethereum/tests RLPTests) -------------------------------------------------------------------
  const rlpIn = (x) => (Array.isArray(x) ? x.map(rlpIn) : typeof x === 'string' && x[0] === '#' ? BigInt(x.slice(1)) : x);
  for (const [name, v] of Object.entries(V.rlp)) {
    const enc = rlpEncode(rlpIn(v.in));
    eq(`rlp ${name}`, h(enc), v.out.toLowerCase());
    eq(`rlp ${name} round trip`, h(rlpEncode(rlpDecode(v.out))), v.out.toLowerCase());
    count('RLPTests valid');
  }
  for (const [name, out] of Object.entries(V.rlpInvalid)) { throws(`rlp invalid ${name}`, () => rlpDecode(out)); count('RLPTests invalid'); }
  eq('rlp stream', rlpToHex(rlpDecode('0x8203e8c0', { stream: true })), ['0x03e8', []]);
  eq('rlp hex string item', h(rlpEncode(['0x', '0x7f', '0x80'])), '0xc4807f8180');
  throws('rlp trailing bytes', () => rlpDecode('0x0101'));

  // --- addresses ---------------------------------------------------------------------------------------------
  const KEYADDR = [['cow', 'cd2a3d9f938e13cd947ec05abc7fe734df8dd826'], ['horse', '13978aee95f38490e9769c39b2773ed763d9cd5f']];
  for (const [seed, addr] of KEYADDR) { eq(`keyaddr ${seed}`, A.privateKeyToAddress(keccak256(utf8ToBytes(seed))).toLowerCase(), '0x' + addr); count('BasicTests keyaddrtest'); }
  const EIP55 = ['0x52908400098527886E0F7030069857D2E4169EE7', '0x8617E340B3D01FA5F11F306F4090FD50E238070D', '0xde709f2102306220921060314715629080e2fb77', '0x27b1fdb04752bbc536007a920d24acb045561c26', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'];
  for (const a of EIP55) {
    eq(`eip55 ${a}`, A.toChecksumAddress(a.toLowerCase()), a);
    eq(`eip55 strict ${a}`, A.isAddress(a, { strict: true }), true);
    count('EIP-55');
  }
  const ETH_1191 = ['0x27b1fdb04752bbc536007a920d24acb045561c26', '0x3599689E6292b81B2d85451025146515070129Bb', '0x42712D45473476b98452f434e72461577D686318', '0x52908400098527886E0F7030069857D2E4169EE7', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0x6549f4939460DE12611948b3f82b88C3C8975323', '0x66f9664f97F2b50F62D13eA064982f936dE76657', '0x8617E340B3D01FA5F11F306F4090FD50E238070D', '0x88021160C5C792225E4E5452585947470010289D', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xde709f2102306220921060314715629080e2fb77', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'];
  const RSK_MAIN = ['0x27b1FdB04752BBc536007A920D24ACB045561c26', '0x3599689E6292B81B2D85451025146515070129Bb', '0x42712D45473476B98452f434E72461577d686318', '0x52908400098527886E0F7030069857D2E4169ee7', '0x5aaEB6053f3e94c9b9a09f33669435E7ef1bEAeD', '0x6549F4939460DE12611948B3F82B88C3C8975323', '0x66F9664f97f2B50F62d13EA064982F936de76657', '0x8617E340b3D01Fa5f11f306f4090fd50E238070D', '0x88021160c5C792225E4E5452585947470010289d', '0xD1220A0Cf47c7B9BE7a2e6ba89F429762E7B9adB', '0xDBF03B407c01E7CD3cBea99509D93F8Dddc8C6FB', '0xDe709F2102306220921060314715629080e2FB77', '0xFb6916095cA1Df60bb79ce92cE3EA74c37c5d359'];
  const RSK_TEST = ['0x27B1FdB04752BbC536007a920D24acB045561C26', '0x3599689e6292b81b2D85451025146515070129Bb', '0x42712D45473476B98452F434E72461577D686318', '0x52908400098527886E0F7030069857D2e4169EE7', '0x5aAeb6053F3e94c9b9A09F33669435E7EF1BEaEd', '0x6549f4939460dE12611948b3f82b88C3c8975323', '0x66f9664F97F2b50f62d13eA064982F936DE76657', '0x8617e340b3D01fa5F11f306F4090Fd50e238070d', '0x88021160c5C792225E4E5452585947470010289d', '0xd1220a0CF47c7B9Be7A2E6Ba89f429762E7b9adB', '0xdbF03B407C01E7cd3cbEa99509D93f8dDDc8C6fB', '0xDE709F2102306220921060314715629080e2Fb77', '0xFb6916095CA1dF60bb79CE92ce3Ea74C37c5D359'];
  for (const [chain, list] of [[1, ETH_1191], [30, RSK_MAIN], [31, RSK_TEST]]) {
    for (const a of list) { eq(`eip1191 ${chain} ${a}`, A.toChecksumAddress(a, chain), a); count('EIP-1191'); }
  }
  eq('isChecksumAddress chain 30', A.isChecksumAddress(RSK_MAIN[0], 30), true);
  eq('isAddress lower', A.isAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), true);
  eq('isAddress bad checksum', A.isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), false);
  eq('isAddress strict lower', A.isAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', { strict: true }), false);
  eq('isAddress short', A.isAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea'), false);
  eq('getAddress', A.getAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  throws('getAddress bad checksum', () => A.getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'));
  eq('shortAddress', A.shortAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAe…eAed');
  eq('equalAddress', A.equalAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'), true);
  const CREATE2 = [
    ['0x0000000000000000000000000000000000000000', '0x' + '00'.repeat(32), '0x00', '0x4D1A2e2bB4F88F0250f26Ffff098B0b30B26BF38'],
    ['0xdeadbeef00000000000000000000000000000000', '0x' + '00'.repeat(32), '0x00', '0xB928f69Bb1D91Cd65274e3c79d8986362984fDA3'],
    ['0xdeadbeef00000000000000000000000000000000', '0x000000000000000000000000feed000000000000000000000000000000000000', '0x00', '0xD04116cDd17beBE565EB2422F2497E06cC1C9833'],
    ['0x0000000000000000000000000000000000000000', '0x' + '00'.repeat(32), '0xdeadbeef', '0x70f2b2914A2a4b783FaEFb75f459A580616Fcb5e'],
    ['0x00000000000000000000000000000000deadbeef', '0x00000000000000000000000000000000000000000000000000000000cafebabe', '0xdeadbeef', '0x60f3f640a8508fC6a86d45DF051962668E1e8AC7'],
    ['0x00000000000000000000000000000000deadbeef', '0x00000000000000000000000000000000000000000000000000000000cafebabe', '0x' + 'deadbeef'.repeat(11), '0x1d8bfDC5D46DC4f61D6b6115972536eBE6A8854C'],
    ['0x0000000000000000000000000000000000000000', '0x' + '00'.repeat(32), '0x', '0xE33C0C7F7df4809055C3ebA6c09CFe4BaF1BD9e0'],
  ];
  for (const [from, salt, code, want] of CREATE2) { eq(`create2 ${want}`, A.create2Address(from, salt, keccak256(U.fromHex(code))), want); count('EIP-1014 CREATE2'); }
  // CREATE: the first contracts of the Hardhat / Anvil account #0 (well-known development addresses).
  eq('create nonce 0', A.contractAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 0), '0x5FbDB2315678afecb367f032d93F642f64180aa3');
  eq('create nonce 1', A.contractAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1n), '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');
  eq('create nonce 2', A.contractAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 2), '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0');

  // --- transactions ------------------------------------------------------------------------------------------
  // EIP-155 example.
  const t155 = { nonce: 9, gasPrice: 20n * 10n ** 9n, gasLimit: 21000, to: '0x3535353535353535353535353535353535353535', value: 10n ** 18n, data: '', chainId: 1 };
  eq('eip155 signing data', T.serializeTransaction(t155), '0xec098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a764000080018080');
  eq('eip155 signing hash', h(T.signingHash(t155)), '0xdaf5a779ae972f972197303d7b574746c7ef83eadac0f2791ad23db92e4c8e53');
  const s155 = T.signTransaction(t155, '0x4646464646464646464646464646464646464646464646464646464646464646');
  eq('eip155 v r s', [s155.tx.v, s155.tx.r, s155.tx.s], [37n, 18515461264373351373200002665853028612451056578545711640558177340181847433846n, 46948507304638947509940763649030358759909902576025900602547168820602576006531n]);
  eq('eip155 signed', s155.raw, '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83');
  const p155 = T.parseTransaction(s155.raw);
  eq('eip155 parse', [p155.type, p155.chainId, p155.nonce, p155.to, p155.value, p155.from, p155.hash], [0, 1n, 9n, '0x3535353535353535353535353535353535353535', 10n ** 18n, A.privateKeyToAddress('0x4646464646464646464646464646464646464646464646464646464646464646'), s155.hash]);
  eq('eip155 recoverSender', T.recoverSender(p155), p155.from);
  count('EIP-155 example', 5);
  // BasicTests/txtest.json (Frontier: no chain id; the second one has a high S, re-signing gives its low-S twin).
  for (const v of V.txtest) {
    const p = T.parseTransaction('0x' + v.signed);
    eq(`txtest sender ${v.key.slice(0, 6)}`, p.from, A.privateKeyToAddress(v.key));
    eq(`txtest fields ${v.key.slice(0, 6)}`, [p.nonce, p.gasPrice, p.gasLimit, p.to && p.to.toLowerCase(), p.value, p.data], [BigInt(v.nonce), BigInt(v.gasprice), BigInt(v.startgas), v.to ? '0x' + v.to : null, BigInt(v.value), '0x' + v.data]);
    eq(`txtest reserialize ${v.key.slice(0, 6)}`, T.serializeTransaction(p), '0x' + v.signed);
    const u = T.parseTransaction('0x' + v.unsigned);
    eq(`txtest unsigned ${v.key.slice(0, 6)}`, [u.r, u.from, u.chainId], [undefined, undefined, null]);
    const re = T.signTransaction({ nonce: v.nonce, gasPrice: v.gasprice, gasLimit: v.startgas, to: v.to ? '0x' + v.to : null, value: BigInt(v.value), data: v.data }, v.key);
    const lowS = p.s > CURVE.n / 2n ? CURVE.n - p.s : p.s;
    eq(`txtest re-sign ${v.key.slice(0, 6)}`, [re.tx.r, re.tx.s, re.tx.from], [p.r, lowS, p.from]);
    count('BasicTests txtest');
  }
  // JSON-RPC shaped transactions (hex quantities, `gas` / `input`): the sender is recovered from them too.
  const rpcShape = (p) => ({ type: '0x' + p.type.toString(16), nonce: U.toQuantity(p.nonce), gasPrice: U.toQuantity(p.gasPrice), gas: U.toQuantity(p.gasLimit), to: p.to, value: U.toQuantity(p.value), input: p.data, v: U.toQuantity(p.v), r: U.toQuantity(p.r), s: U.toQuantity(p.s), chainId: '0x1' });
  eq('rpc-shaped eip155 sender', T.recoverSender(RPC.formatTransaction(rpcShape(p155))), p155.from);
  const frontier = T.parseTransaction('0x' + V.txtest[0].signed);
  eq('rpc-shaped unprotected sender (chainId ignored for v 27)', T.recoverSender(rpcShape(frontier)), frontier.from);
  throws('chainId contradicts v', () => T.normalizeTransaction({ ...rpcShape(p155), chainId: 5 }), 'INVALID_CHAINID');
  // ethereum/tests TransactionTests (Prague).
  for (const [name, raw, hash, sender, gas] of V.transactionTests.valid) {
    let got;
    try {
      const p = T.parseTransaction(raw);
      got = [p.hash, p.from.toLowerCase(), '0x' + T.intrinsicGas(p).toString(16), T.validateTransaction(p, { chainId: 1 })];
    } catch (e) { got = String(e.message); }
    eq(`TransactionTests ${name}`, got, [hash, sender, '0x' + BigInt(gas).toString(16), []]);
    count('TransactionTests valid');
  }
  for (const [name, raw, exception] of V.transactionTests.invalid) {
    let rejected = false;
    try { rejected = T.validateTransaction(T.parseTransaction(raw), { chainId: 1 }).length > 0; } catch { rejected = true; }
    eq(`TransactionTests ${name} (${exception})`, rejected, true);
    count('TransactionTests invalid');
  }
  // Typed transactions: sign, serialize, parse round trips (Hardhat account #0 and #1 keys).
  const K0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const K1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const ADDR0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', ADDR1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const t2 = { chainId: 11155111, nonce: 7, maxPriorityFeePerGas: U.parseGwei('1.5'), maxFeePerGas: U.parseGwei('30'), gasLimit: 60000, to: ADDR1, value: U.parseEther('0.01'), data: E.erc20TransferData(ADDR1, 5n), accessList: [{ address: ADDR1, storageKeys: ['0x' + '00'.repeat(31) + '01'] }] };
  const s2 = T.signTransaction(t2, K0);
  eq('type 2 prefix', s2.raw.slice(0, 4), '0x02');
  const p2 = T.parseTransaction(s2.raw);
  eq('type 2 round trip', [p2.type, p2.chainId, p2.nonce, p2.maxFeePerGas, p2.maxPriorityFeePerGas, p2.gasLimit, p2.to, p2.value, p2.data, p2.accessList, p2.from, p2.hash, p2.yParity === s2.tx.yParity],
    [2, 11155111n, 7n, 30000000000n, 1500000000n, 60000n, ADDR1, 10n ** 16n, t2.data, t2.accessList, ADDR0, s2.hash, true]);
  eq('type 2 serialize(parse)', T.serializeTransaction(p2), s2.raw);
  eq('type 2 unsigned round trip', T.serializeTransaction(T.parseTransaction(T.serializeTransaction(t2))), T.serializeTransaction(t2));
  eq('type 2 low S', p2.s <= CURVE.n / 2n, true);
  // transfer(ADDR1, 5): 4 + 20 + 1 non-zero bytes, 12 + 31 zero bytes; one address and one key in the access list.
  eq('type 2 intrinsic gas', T.intrinsicGas(p2), 21000n + 25n * 16n + 43n * 4n + 2400n + 1900n);
  eq('type 2 cost', T.maxTransactionCost(p2), 60000n * 30000000000n + 10n ** 16n);
  eq('type 2 effective price', T.effectiveGasPrice(p2, U.parseGwei('10')), U.parseGwei('11.5'));
  const t1 = { type: 1, chainId: 1, nonce: 0, gasPrice: U.parseGwei('20'), gasLimit: 30000, to: ADDR1, value: 1n, accessList: [] };
  const s1 = T.signTransaction(t1, K1);
  const p1 = T.parseTransaction(s1.raw);
  eq('type 1 round trip', [s1.raw.slice(0, 4), p1.type, p1.gasPrice, p1.from, T.serializeTransaction(p1) === s1.raw], ['0x01', 1, 20000000000n, ADDR1, true]);
  const s0 = T.signTransaction({ nonce: 1, gasPrice: 1, gasLimit: 21000, to: ADDR1, value: 1, chainId: 31337 }, K0);
  eq('legacy chain 31337 v', [T.parseTransaction(s0.raw).chainId, s0.tx.v === 31337n * 2n + 35n + BigInt(s0.tx.yParity)], [31337n, true]);
  eq('legacy no chain id v', T.signTransaction({ nonce: 1, gasPrice: 1, gasLimit: 21000, to: ADDR1 }, K0).tx.v >= 27n, true);
  eq('creation', T.parseTransaction(T.signTransaction({ chainId: 1, maxFeePerGas: 2, gasLimit: 100000, data: '0x6000' }, K0).raw).to, null);
  throws('typed needs chainId', () => T.signTransaction({ maxFeePerGas: 1, gasLimit: 21000, to: ADDR1 }, K0));
  throws('type 3 not signed', () => T.signTransaction({ type: 3, chainId: 1, to: ADDR1, blobVersionedHashes: [] }, K0));
  eq('txTypeName', [0, 1, 2, 3, 4].map(T.txTypeName), ['legacy', 'EIP-2930', 'EIP-1559', 'EIP-4844', 'EIP-7702']);
  // Types 3 and 4: built and signed by hand, parsed for an explorer.
  const blobHash = '0x01' + 'ab'.repeat(31);
  const t3 = T.normalizeTransaction({ type: 3, chainId: 1, nonce: 2, maxPriorityFeePerGas: 1, maxFeePerGas: 100, gasLimit: 21000, to: ADDR1, value: 0, maxFeePerBlobGas: 7, blobVersionedHashes: [blobHash] });
  const sig3 = ecdsaSign(T.signingHash(t3), U.fromHex(K0));
  const raw3 = T.serializeTransaction(t3, { r: sig3.r, s: sig3.s, yParity: sig3.recovery });
  const p3 = T.parseTransaction(raw3);
  eq('type 3 parse', [p3.type, p3.from, p3.maxFeePerBlobGas, p3.blobVersionedHashes, T.validateTransaction(p3)], [3, ADDR0, 7n, [blobHash], []]);
  eq('type 3 cost', T.maxTransactionCost(p3), 21000n * 100n + 131072n * 7n);
  const body3 = rlpDecode(U.fromHex(raw3).subarray(1));
  const wrapped = '0x03' + bytesToHex(rlpEncode([body3, [new Uint8Array(8)], [new Uint8Array(48).fill(0xc0)], [new Uint8Array(48)]]));
  const pw3 = T.parseTransaction(wrapped);
  eq('type 3 network form', [pw3.hash, pw3.from, pw3.sidecar.blobs, pw3.sidecar.commitments.length], [p3.hash, ADDR0, 1, 1]);
  const auth = { chainId: 1, address: '0x' + '42'.repeat(20), nonce: 5 };
  const sa = ecdsaSign(T.authorizationHash(auth), U.fromHex(K1));
  const t4 = T.normalizeTransaction({ type: 4, chainId: 1, nonce: 3, maxPriorityFeePerGas: 1, maxFeePerGas: 100, gasLimit: 100000, to: ADDR0, authorizationList: [{ ...auth, yParity: sa.recovery, r: sa.r, s: sa.s }] });
  const sig4 = ecdsaSign(T.signingHash(t4), U.fromHex(K0));
  const p4 = T.parseTransaction(T.serializeTransaction(t4, { r: sig4.r, s: sig4.s, yParity: sig4.recovery }));
  eq('type 4 parse', [p4.type, p4.from, p4.authorizationList[0].authority, p4.authorizationList[0].nonce, T.intrinsicGas(p4)], [4, ADDR0, ADDR1, 5n, 46000n]);
  eq('type 4 empty list invalid', T.validateTransaction({ ...p4, authorizationList: [] }).includes('TYPE_4_EMPTY_AUTHORIZATION_LIST'), true);
  throws('parse unknown type', () => T.parseTransaction('0x05c0'), 'TYPE_NOT_SUPPORTED');
  throws('parse garbage', () => T.parseTransaction('0x01ff'));

  // --- messages (EIP-191, ERC-2098, EIP-712) -------------------------------------------------------------------
  const K2098 = '0x1234567890123456789012345678901234567890123456789012345678901234';
  const ERC2098 = [
    ['Hello World', '0x68a020a209d3d56c46f38cc50a33f704f4a9a10a59377f8dd762ac66910e9b90', '0x7e865ad05c4035ab5792787d4a0297a43617ae897930a6fe4d822b8faea52064', 27, '0x7e865ad05c4035ab5792787d4a0297a43617ae897930a6fe4d822b8faea52064'],
    ["It's a small(er) world", '0x9328da16089fcba9bececa81663203989f2df5fe1faa6291a45381c81bd17f76', '0x139c6d6b623b42da56557e5e734a43dc83345ddfadec52cbe24d0cc64f550793', 28, '0x939c6d6b623b42da56557e5e734a43dc83345ddfadec52cbe24d0cc64f550793'],
  ];
  for (const [msg, r, s, v, ys] of ERC2098) {
    const sig = M.signMessage(msg, K2098);
    const sp = M.splitSignature(sig);
    eq(`erc2098 ${msg}`, [sp.r, sp.s, sp.v, sp.compact], [r, s, v, r + ys.slice(2)]);
    const cs = M.splitSignature(r + ys.slice(2));
    eq(`erc2098 compact ${msg}`, [cs.s, cs.v, M.joinSignature(cs)], [s, v, sig]);
    eq(`erc2098 verify ${msg}`, [M.verifyMessage(msg, sig, A.privateKeyToAddress(K2098)), M.verifyMessage(msg, r + ys.slice(2), A.privateKeyToAddress(K2098)), M.verifyMessage(msg + '!', sig, A.privateKeyToAddress(K2098))], [true, true, false]);
    count('ERC-2098');
  }
  eq('hashMessage bytes = string', M.hashMessage(utf8ToBytes('abc')), M.hashMessage('abc'));
  eq('hashMessage manual', M.hashMessage('abc'), h(keccak256(utf8ToBytes('\x19Ethereum Signed Message:\n3abc'))));
  eq('splitSignature v 0/1', M.splitSignature(M.signMessage('x', K0).slice(0, 130) + '01').v, 28);
  throws('splitSignature short', () => M.splitSignature('0x1234'));
  const mail = {
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
      Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
    },
    primaryType: 'Mail',
    domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
    message: { from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' }, to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' }, contents: 'Hello, Bob!' },
  };
  const cow = keccak256(utf8ToBytes('cow'));
  eq('eip712 encodeType', M.encodeType(mail.types, 'Mail'), 'Mail(Person from,Person to,string contents)Person(string name,address wallet)');
  eq('eip712 typeHash', M.typeHash(mail.types, 'Mail'), '0xa0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2');
  eq('eip712 encodeData', M.encodeData(mail.types, 'Mail', mail.message), '0xa0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8');
  eq('eip712 hashStruct', M.hashStruct(mail.types, 'Mail', mail.message), '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e');
  eq('eip712 domain separator', M.hashDomain(mail.domain), '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f');
  eq('eip712 hash', M.hashTypedData(mail), '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  eq('eip712 signer', A.privateKeyToAddress(cow), '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826');
  const mailSig = M.signTypedData(mail, cow);
  eq('eip712 signature', mailSig, '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c');
  eq('eip712 recover', M.recoverTypedDataAddress(mail, mailSig), '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826');
  count('EIP-712 Mail', 9);
  // Arrays, bytes, nested arrays of structs: the rules of encodeData written out by hand.
  const groupTypes = { Person: mail.types.Person, Group: [{ name: 'name', type: 'string' }, { name: 'members', type: 'Person[]' }, { name: 'ids', type: 'uint8[2]' }, { name: 'blob', type: 'bytes' }, { name: 'flag', type: 'bool' }, { name: 'tag', type: 'bytes4' }, { name: 'delta', type: 'int16' }] };
  const group = { name: 'g', members: [mail.message.from, mail.message.to], ids: [1, 2], blob: '0x0102', flag: true, tag: '0xdeadbeef', delta: -2 };
  const enc = (t, v) => U.fromHex(ABI.encodeParameters([t], [v]));
  const manual = keccak256(concatBytes(
    U.fromHex(M.typeHash(groupTypes, 'Group')), keccak256(utf8ToBytes('g')),
    keccak256(concatBytes(U.fromHex(M.hashStruct(groupTypes, 'Person', group.members[0])), U.fromHex(M.hashStruct(groupTypes, 'Person', group.members[1])))),
    keccak256(concatBytes(enc('uint8', 1), enc('uint8', 2))), keccak256(Uint8Array.of(1, 2)), enc('bool', true), enc('bytes4', '0xdeadbeef'), enc('int16', -2)));
  eq('eip712 arrays', M.hashStruct(groupTypes, 'Group', group), h(manual));
  eq('eip712 encodeType deps', M.encodeType(groupTypes, 'Group'), 'Group(string name,Person[] members,uint8[2] ids,bytes blob,bool flag,bytes4 tag,int16 delta)Person(string name,address wallet)');
  throws('eip712 fixed array length', () => M.hashStruct(groupTypes, 'Group', { ...group, ids: [1] }));
  throws('eip712 missing field', () => M.hashStruct(groupTypes, 'Group', { name: 'x' }));
  eq('eip712 inferred domain', M.hashDomain({ name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: mail.domain.verifyingContract }), '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f');

  // --- ABI -------------------------------------------------------------------------------------------------------
  const SPEC = [
    ['function baz(uint32 x, bool y) returns (bool r)', [69, true], '0xcdcd77c000000000000000000000000000000000000000000000000000000000000000450000000000000000000000000000000000000000000000000000000000000001'],
    ['bar(bytes3[2])', [['0x616263', '0x646566']], '0xfce353f661626300000000000000000000000000000000000000000000000000000000006465660000000000000000000000000000000000000000000000000000000000'],
    ['sam(bytes,bool,uint[])', ['0x64617665', true, [1, 2, 3]], '0xa5643bf20000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000464617665000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003'],
    ['f(uint,uint32[],bytes10,bytes)', [0x123, [0x456, 0x789], h(utf8ToBytes('1234567890')), h(utf8ToBytes('Hello, world!'))], '0x8be65246' + ['123', '80', '3132333435363738393000000000000000000000000000000000000000000000', 'e0', '2', '456', '789', 'd', '48656c6c6f2c20776f726c642100000000000000000000000000000000000000'].map((w) => (w.length === 64 ? w : w.padStart(64, '0'))).join('')],
    ['g(uint256[][],string[])', [[[1, 2], [3]], ['one', 'two', 'three']], '0x2289b18c' + ['40', '140', '2', '40', 'a0', '2', '1', '2', '1', '3', '3', '60', 'a0', 'e0', '3', '6f6e650000000000000000000000000000000000000000000000000000000000', '3', '74776f0000000000000000000000000000000000000000000000000000000000', '5', '7468726565000000000000000000000000000000000000000000000000000000'].map((w) => (w.length === 64 ? w : w.padStart(64, '0'))).join('')],
  ];
  for (const [sig, args, want] of SPEC) {
    eq(`abi spec ${sig}`, ABI.encodeFunctionData(sig, args), want);
    const d = ABI.decodeFunctionData(sig, want);
    eq(`abi spec decode ${sig}`, ABI.encodeFunctionData(sig, d.args), want);
    count('Solidity ABI spec examples');
  }
  eq('abi decode g values', J(ABI.decodeFunctionData(SPEC[4][0], SPEC[4][2]).args), J([[[1n, 2n], [3n]], ['one', 'two', 'three']]));
  for (const [name, v] of Object.entries(V.abi)) {
    const args = v.args.map((a, i) => (v.types[i].startsWith('bytes') ? h(utf8ToBytes(a)) : a));
    eq(`ABITests ${name}`, ABI.encodeParameters(v.types, args), '0x' + v.result);
    count('ABITests');
  }
  eq('abi packed', ABI.encodePacked(['int16', 'bytes1', 'uint16', 'string'], [-1, '0x42', 3, 'Hello, world!']), '0xffff42000348656c6c6f2c20776f726c6421');
  eq('abi error selector', ABI.functionSelector('error InsufficientBalance(uint256 available, uint256 required)'), '0xcf479181');
  const specJson = [{ name: 'f', type: 'function', inputs: [{ name: 's', type: 'tuple', components: [{ name: 'a', type: 'uint256' }, { name: 'b', type: 'uint256[]' }, { name: 'c', type: 'tuple[]', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] }] }, { name: 't', type: 'tuple', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] }, { name: 'a', type: 'uint256' }], outputs: [] }];
  const specAbi = ABI.parseAbi(JSON.stringify(specJson));
  eq('abi json tuples signature', specAbi.functions[0].signature, 'f((uint256,uint256[],(uint256,uint256)[]),(uint256,uint256),uint256)');
  eq('abi json -> human', ABI.formatFragment(specAbi.functions[0]), 'function f((uint256 a, uint256[] b, (uint256 x, uint256 y)[] c) s, (uint256 x, uint256 y) t, uint256 a)');
  eq('abi human -> json', ABI.formatFragment(ABI.formatFragment(specAbi.functions[0]), 'json'), ABI.formatFragment(specJson[0], 'json'));
  const tupleCall = ABI.encodeFunctionData(specAbi.functions[0], [{ a: 1, b: [2, 3], c: [{ x: 4, y: 5 }] }, [6, 7], 8]);
  const tupleArgs = ABI.decodeFunctionData(specAbi, tupleCall).args;
  eq('abi tuple named values', [tupleArgs.s.a, tupleArgs.s.c[0].y, tupleArgs.t.x, tupleArgs.a], [1n, 5n, 6n, 8n]);
  const erc20 = ABI.parseAbi(E.ERC20_ABI);
  eq('abi byName / selector', [erc20.byName('transfer').selector, erc20.bySelector('0xa9059cbb').name, erc20.byName('Transfer').topic], ['0xa9059cbb', 'transfer', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']);
  eq('abi result', ABI.decodeFunctionResult(erc20.byName('balanceOf'), ABI.encodeFunctionResult('function balanceOf(address) returns (uint256)', [42n]))[0], 42n);
  eq('abi human modifiers', ABI.parseFragment('function deposit(address payable to, string memory note) external payable returns (uint256 id);').signature, 'deposit(address,string)');
  throws('abi overloaded name', () => ABI.parseAbi(E.ERC721_ABI).byName('safeTransferFrom'));
  eq('abi overloaded signature', ABI.parseAbi(E.ERC721_ABI).byName('safeTransferFrom(address,address,uint256)').selector, '0x42842e0e');
  eq('abi intN round trip', ABI.decodeParameters(['int8', 'int256', 'uint8'], ABI.encodeParameters(['int8', 'int256', 'uint8'], [-128, -1n, 255])), [-128n, -1n, 255n]);
  throws('abi uint8 range', () => ABI.encodeParameters(['uint8'], [256]));
  throws('abi int8 range', () => ABI.encodeParameters(['int8'], [128]));
  throws('abi bytes4 length', () => ABI.encodeParameters(['bytes4'], ['0x01']));
  throws('abi bad checksum', () => ABI.encodeParameters(['address'], ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD']));
  const word = (x) => x.padStart(64, '0');
  throws('abi strict address', () => ABI.decodeParameters(['address'], '0x' + word('1' + '00'.repeat(20))));
  throws('abi strict bool', () => ABI.decodeParameters(['bool'], '0x' + word('2')));
  throws('abi strict uint8', () => ABI.decodeParameters(['uint8'], '0x' + word('100')));
  throws('abi strict int8 sign', () => ABI.decodeParameters(['int8'], '0x' + word('80')));
  throws('abi strict bytes1 padding', () => ABI.decodeParameters(['bytes1'], '0x' + 'ff'.repeat(2) + '00'.repeat(30)));
  throws('abi short data', () => ABI.decodeParameters(['uint256'], '0x1234'));
  throws('abi offset out of range', () => ABI.decodeParameters(['bytes'], '0x' + word('1000')));
  throws('abi bytes length past end', () => ABI.decodeParameters(['bytes'], '0x' + word('20') + word('40')));
  throws('abi bytes dirty padding', () => ABI.decodeParameters(['bytes'], '0x' + word('20') + word('1') + 'aa' + 'bb' + '00'.repeat(30)));
  throws('abi array length past end', () => ABI.decodeParameters(['uint256[]'], '0x' + word('20') + word('ffffffff')));
  // Overlapping offsets: every element of a long outer array points at the same inner array.
  const bomb = '0x' + word('20') + word('400') + word('8000').repeat(0x400) + word('400') + word('0').repeat(0x400);
  throws('abi decoding work limit', () => ABI.decodeParameters(['uint256[][]'], bomb));
  // Events: ERC-20 vs ERC-721 Transfer (same topic, different indexed count), indexed string.
  const pad = (a) => '0x' + word(a.slice(2).toLowerCase());
  const t20 = { topics: [erc20.byName('Transfer').topic, pad(ADDR0), pad(ADDR1)], data: ABI.encodeParameters(['uint256'], [1000n]) };
  const d20 = ABI.decodeEventLog(erc20, t20);
  eq('event erc20', [d20.name, d20.args.from, d20.args.to, d20.args.value], ['Transfer', ADDR0, ADDR1, 1000n]);
  eq('event wrong indexed count', ABI.decodeEventLog(erc20, { ...t20, topics: [...t20.topics, pad('0x07')], data: '0x' }), null);
  eq('event topics', ABI.encodeEventTopics(erc20.byName('Transfer'), [null, ADDR1]), [erc20.byName('Transfer').topic, null, pad(ADDR1)]);
  const named = ABI.parseFragment('event Named(string indexed name, uint256[] indexed ids, bytes data)');
  const namedTopics = ABI.encodeEventTopics(named, ['alice', [1, 2]]);
  eq('event indexed string topic', namedTopics[1], h(keccak256(utf8ToBytes('alice'))));
  eq('event indexed array topic', namedTopics[2], h(keccak256(concatBytes(U.fromHex(ABI.encodeParameters(['uint256'], [1])), U.fromHex(ABI.encodeParameters(['uint256'], [2]))))));
  eq('event indexed decode', J(ABI.decodeEventLog(named, { topics: namedTopics, data: ABI.encodeParameters(['bytes'], ['0x01']) }).args), J([namedTopics[1], namedTopics[2], '0x01']));
  // Errors.
  const revert = ABI.encodeErrorResult('Error(string)', ['Not enough']);
  eq('error string', [revert.slice(0, 10), ABI.decodeErrorResult(null, revert).reason], ['0x08c379a0', 'Not enough']);
  const panic = ABI.decodeErrorResult(null, ABI.encodeErrorResult('Panic(uint256)', [0x32]));
  eq('error panic', [panic.code, panic.reason], [0x32n, 'array index out of bounds']);
  const custom = ABI.decodeErrorResult(['error Insufficient(uint256 need)'], ABI.encodeErrorResult('error Insufficient(uint256 need)', [9]));
  eq('error custom', [custom.name, custom.args.need], ['Insufficient', 9n]);
  eq('error unknown', ABI.decodeErrorResult([], '0x12345678'), null);
  eq('formatAbiValue', ABI.formatAbiValue([[1n, ADDR0.toLowerCase(), 'hi', true, '0x01']], '(uint256,address,string,bool,bytes)[]'), `[(1, ${ADDR0}, "hi", true, 0x01)]`);
  eq('encodeDeployData', ABI.encodeDeployData('constructor(uint256 x)', '0x6000', [1]), '0x6000' + word('1'));

  // --- ERC token helpers -----------------------------------------------------------------------------------------
  const SIGS = {
    erc165: ['supportsInterface(bytes4)'],
    erc721: ['balanceOf(address)', 'ownerOf(uint256)', 'safeTransferFrom(address,address,uint256,bytes)', 'safeTransferFrom(address,address,uint256)', 'transferFrom(address,address,uint256)', 'approve(address,uint256)', 'setApprovalForAll(address,bool)', 'getApproved(uint256)', 'isApprovedForAll(address,address)'],
    erc721Metadata: ['name()', 'symbol()', 'tokenURI(uint256)'],
    erc721Enumerable: ['totalSupply()', 'tokenOfOwnerByIndex(address,uint256)', 'tokenByIndex(uint256)'],
    erc721Receiver: ['onERC721Received(address,address,uint256,bytes)'],
    erc1155: ['safeTransferFrom(address,address,uint256,uint256,bytes)', 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', 'balanceOf(address,uint256)', 'balanceOfBatch(address[],uint256[])', 'setApprovalForAll(address,bool)', 'isApprovedForAll(address,address)'],
    erc1155MetadataURI: ['uri(uint256)'],
    erc1155Receiver: ['onERC1155Received(address,address,uint256,uint256,bytes)', 'onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)'],
    erc2981: ['royaltyInfo(uint256,uint256)'],
  };
  for (const [k, sigs] of Object.entries(SIGS)) { eq(`interface id ${k}`, E.interfaceId(sigs), E.INTERFACE_IDS[k]); count('ERC-165 interface ids'); }
  eq('erc1155 acceptance values', [ABI.functionSelector('onERC1155Received(address,address,uint256,uint256,bytes)'), ABI.functionSelector('onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)')], ['0xf23a6e61', '0xbc197c81']);
  eq('erc165 call data', E.supportsInterfaceData('0x01ffc9a7'), '0x01ffc9a701ffc9a700000000000000000000000000000000000000000000000000000000');
  eq('erc20 transfer data', E.erc20TransferData(ADDR1, 5n), '0xa9059cbb' + word(ADDR1.slice(2).toLowerCase()) + word('5'));
  eq('decode erc20 transfer', E.decodeTokenTransfer(E.erc20TransferData(ADDR1, 5n)), { standard: 'erc20', method: 'transfer', to: ADDR1, amount: 5n });
  eq('decode erc721 safe transfer', E.decodeTokenTransfer(E.erc721SafeTransferData(ADDR0, ADDR1, 77n)), { standard: 'erc721', method: 'safeTransferFrom', from: ADDR0, to: ADDR1, tokenId: 77n });
  eq('decode erc1155 transfer', E.decodeTokenTransfer(E.erc1155SafeTransferData(ADDR0, ADDR1, 3, 10)), { standard: 'erc1155', method: 'safeTransferFrom', from: ADDR0, to: ADDR1, tokenId: 3n, amount: 10n, data: '0x' });
  eq('decode erc1155 batch', E.decodeTokenTransfer(E.erc1155SafeBatchTransferData(ADDR0, ADDR1, [1, 2], [3, 4])).amounts, [3n, 4n]);
  eq('decode transferFrom ambiguity', E.decodeTokenTransfer(E.erc20TransferFromData(ADDR0, ADDR1, 9)).ambiguous, 'erc721');
  eq('decode approve is no transfer', E.decodeTokenTransfer(E.erc20ApproveData(ADDR1, 1)), null);
  eq('decode garbage', E.decodeTokenTransfer('0x'), null);
  eq('abis parse', [E.ERC20_ABI, E.ERC721_ABI, E.ERC1155_ABI, E.WETH_ABI].map((a) => ABI.parseAbi(a).fragments.length), [11, 16, 12, 15]);

  // --- keystore (official vectors keep their KDF parameters) -------------------------------------------------------
  for (const [name, v, job] of keystoreJobs) {
    let got;
    try { got = bytesToHex(await job); } catch (e) { got = 'error: ' + e.message; }
    eq(`keystore ${name}`, got, v.priv);
    count('KeyStoreTests');
  }
  const mc = V.keystore.mycrypto;
  throws('keystore wrong password', () => K.decryptKeystore(mc.json, 'wrong'), 'password');
  eq('keystore address field', K.keystoreAddress(mc.json), A.privateKeyToAddress(mc.priv));
  throws('keystore address mismatch', () => K.decryptKeystore({ ...mc.json, address: ADDR0.slice(2) }, mc.password), 'address');
  throws('keystore version', () => K.decryptKeystore({ ...mc.json, version: 2 }, mc.password), 'format');
  eq('keystore async', bytesToHex(await K.decryptKeystoreAsync(JSON.stringify(mc.json), mc.password, { onProgress: () => {} })), mc.priv);
  const ks1 = K.encryptKeystore(K0, 'pw', { n: 1024, salt: '0x' + '11'.repeat(32), iv: '0x' + '22'.repeat(16), uuid: '00000000-0000-4000-8000-000000000000' });
  eq('keystore encrypt fields', [ks1.version, ks1.address, ks1.crypto.kdf, ks1.crypto.kdfparams.n, ks1.crypto.cipher], [3, ADDR0.slice(2).toLowerCase(), 'scrypt', 1024, 'aes-128-ctr']);
  eq('keystore round trip scrypt', h(K.decryptKeystore(ks1, 'pw')), K0);
  const ks2 = await K.encryptKeystoreAsync(K1, 'pässwörd', { kdf: 'pbkdf2', c: 1000 });
  eq('keystore round trip pbkdf2', [h(K.decryptKeystore(JSON.stringify(ks2), 'pässwörd')), ks2.crypto.kdfparams.prf], [K1, 'hmac-sha256']);
  eq('keystore deterministic', K.encryptKeystore(K0, 'pw', { n: 1024, salt: '0x' + '11'.repeat(32), iv: '0x' + '22'.repeat(16), uuid: ks1.id }), ks1);
  const ac = new AbortController(); ac.abort();
  await rejects('keystore abort', K.decryptKeystoreAsync({ ...ks1, crypto: { ...ks1.crypto, kdfparams: { ...ks1.crypto.kdfparams, n: 65536 } } }, 'pw', { signal: ac.signal }));

  // --- EIP-681 URIs ---------------------------------------------------------------------------------------------------
  const u1 = URI.parseEthereumURI('ethereum:0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359?value=2.014e18');
  eq('eip681 payment', [u1.target, u1.amount, u1.parameters.value, u1.chainId, u1.functionName, u1.checksumOk], ['0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', 2014000000000000000n, 2014000000000000000n, null, null, false]);
  throws('eip681 strict checksum', () => URI.parseEthereumURI('ethereum:0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359?value=1', { strict: true }));
  const u2 = URI.parseEthereumURI('ethereum:0x89205a3a3b2a69de6dbf7f01ed13b2108b2c43e7/transfer?address=0x8e23ee67d1332ad560396262c48ffbb01f93d052&uint256=1');
  eq('eip681 erc20', [u2.token, u2.to, u2.amount, u2.functionName, u2.checksumOk], [A.toChecksumAddress('0x89205a3a3b2a69de6dbf7f01ed13b2108b2c43e7'), A.toChecksumAddress('0x8e23ee67d1332ad560396262c48ffbb01f93d052'), 1n, 'transfer', true]);
  count('EIP-681 examples', 2);
  const u3 = URI.parseEthereumURI('ethereum:pay-alice.eth@11155111?value=1e15&gas=21000&gasPrice=2.5e9&memo=hi%20there');
  eq('eip681 ens, chain, prefix', [u3.prefix, u3.target, u3.chainId, u3.amount, u3.parameters.gasLimit, u3.parameters.gasPrice, u3.parameters.memo], ['pay', 'alice.eth', 11155111, 10n ** 15n, 21000n, 2500000000n, 'hi there']);
  throws('eip681 fractional wei', () => URI.parseEthereumURI(`ethereum:${ADDR0}?value=1.5`));
  throws('eip681 not ethereum', () => URI.parseEthereumURI('bitcoin:abc'));
  eq('eip681 format', URI.formatEthereumURI({ target: '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359', value: 2014000000000000000n }), 'ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359?value=2.014e18');
  const tu = URI.erc20TransferURI('0x89205a3a3b2a69de6dbf7f01ed13b2108b2c43e7', '0x8e23ee67d1332ad560396262c48ffbb01f93d052', 10n ** 18n, 1);
  eq('eip681 transfer format', [tu, URI.parseEthereumURI(tu).amount], [`ethereum:${A.toChecksumAddress('0x89205a3a3b2a69de6dbf7f01ed13b2108b2c43e7')}@1/transfer?address=${A.toChecksumAddress('0x8e23ee67d1332ad560396262c48ffbb01f93d052')}&uint256=1e18`, 10n ** 18n]);
  eq('eip681 numbers', [URI.parseNumber('1.5e3'), URI.parseNumber('100'), URI.formatNumber(123n), URI.formatNumber(1200000n)], [1500n, 100n, '123', '1.2e6']);

  // --- ENS -----------------------------------------------------------------------------------------------------------
  eq('namehash ""', ENS.namehash(''), '0x0000000000000000000000000000000000000000000000000000000000000000');
  eq('namehash eth', ENS.namehash('eth'), '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
  eq('namehash foo.eth', ENS.namehash('foo.eth'), '0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f');
  count('ERC-137 namehash', 3);
  eq('namehash normalises', ENS.namehash('Foo.ETH'), ENS.namehash('foo.eth'));
  eq('labelhash', ENS.labelhash('eth'), h(keccak256(utf8ToBytes('eth'))));
  eq('labelhash encoded label', ENS.namehash(`[${ENS.labelhash('foo').slice(2)}].eth`), ENS.namehash('foo.eth'));
  eq('dnsEncode', ENS.dnsEncode('foo.eth'), '0x03666f6f0365746800');
  eq('normalizeName', [ENS.normalizeName('Nick.ETH'), ENS.normalizeName('_dev.eth'), ENS.normalizeName('café.eth'), ENS.normalizeName('😀.eth')], ['nick.eth', '_dev.eth', 'café.eth', '😀.eth']);
  for (const bad of ['foo..eth', 'foo bar.eth', 'a_b.eth', 'ab--c.eth', 'foo!.eth', '.eth']) throws(`normalizeName rejects ${bad}`, () => ENS.normalizeName(bad));
  eq('isEnsName', [ENS.isEnsName('vitalik.eth'), ENS.isEnsName(ADDR0), ENS.isEnsName('nodot'), ENS.isEnsName('bad name.eth')], [true, false, false, false]);
  // Mock chain: alice.eth with its own resolver, *.wild.eth through an ENSIP-10 resolver, an offchain one.
  const RES = '0x' + '11'.repeat(20), WILD = '0x' + '22'.repeat(20), OFFC = '0x' + '33'.repeat(20);
  const resolvers = { [ENS.namehash('alice.eth')]: RES, [ENS.namehash(ADDR1.slice(2).toLowerCase() + '.addr.reverse')]: RES, [ENS.namehash('wild.eth')]: WILD, [ENS.namehash('off.eth')]: OFFC };
  const ensRpc = {
    async call({ to, data }) {
      const sel = data.slice(0, 10), arg = '0x' + data.slice(10, 74);
      if (to === ENS.ENS_REGISTRY && sel === ABI.functionSelector('resolver(bytes32)')) return ABI.encodeParameters(['address'], [resolvers[arg] || A.ZERO_ADDRESS]);
      if (sel === ABI.functionSelector('supportsInterface(bytes4)')) return ABI.encodeParameters(['bool'], [to === WILD || to === OFFC]);
      if (to === OFFC) throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x556f1830' + '00'.repeat(32) });
      if (to === RES && sel === ABI.functionSelector('addr(bytes32)')) return ABI.encodeParameters(['address'], [arg === ENS.namehash('alice.eth') ? ADDR1 : A.ZERO_ADDRESS]);
      if (to === RES && sel === ABI.functionSelector('name(bytes32)')) return ABI.encodeParameters(['string'], ['alice.eth']);
      if (to === WILD && sel === ABI.functionSelector('resolve(bytes,bytes)')) {
        const [name, inner] = ABI.decodeParameters(['bytes', 'bytes'], '0x' + data.slice(10));
        const ok = name === ENS.dnsEncode('bob.wild.eth') && inner === ABI.encodeFunctionData('addr(bytes32)', [ENS.namehash('bob.wild.eth')]);
        return ABI.encodeParameters(['bytes'], [ABI.encodeParameters(['address'], [ok ? ADDR0 : A.ZERO_ADDRESS])]);
      }
      return '0x';
    },
  };
  eq('ens resolveName', await ENS.resolveName(ensRpc, 'Alice.eth'), ADDR1);
  eq('ens resolveName none', await ENS.resolveName(ensRpc, 'nobody.xyz'), null);
  eq('ens wildcard (ENSIP-10)', await ENS.resolveName(ensRpc, 'bob.wild.eth'), ADDR0);
  eq('ens getResolver parent', await ENS.getResolver(ensRpc, 'bob.wild.eth'), WILD);
  eq('ens lookupAddress', await ENS.lookupAddress(ensRpc, ADDR1), 'alice.eth');
  eq('ens lookupAddress unverified', await ENS.lookupAddress(ensRpc, ADDR0), null);
  await rejects('ens offchain', ENS.resolveName(ensRpc, 'off.eth'), 'OFFCHAIN');

  // --- JSON-RPC client (mocked fetch) ------------------------------------------------------------------------------------
  const sent = [];
  const answer = (body, status = 200) => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const mockFetch = async (url, init) => {
    const req = JSON.parse(init.body);
    sent.push({ url, init, req });
    const one = (r) => {
      switch (r.method) {
        case 'eth_chainId': return { jsonrpc: '2.0', id: r.id, result: '0xaa36a7' };
        case 'eth_blockNumber': return { jsonrpc: '2.0', id: r.id, result: '0x10' };
        case 'eth_getBalance': return { jsonrpc: '2.0', id: r.id, result: '0xde0b6b3a7640000' };
        case 'eth_call': return { jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted', data: revert } };
        case 'eth_feeHistory': return { jsonrpc: '2.0', id: r.id, result: { oldestBlock: '0x1', baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'], gasUsedRatio: [0.5], reward: [['0x1', '0x2', '0x3']] } };
        case 'eth_getTransactionReceipt': return { jsonrpc: '2.0', id: r.id, result: { status: '0x1', gasUsed: '0x5208', blockNumber: '0x10', logs: [{ address: ADDR0.toLowerCase(), topics: t20.topics, data: t20.data, logIndex: '0x2', blockNumber: '0x10' }] } };
        default: return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'method not found' } };
      }
    };
    return answer(Array.isArray(req) ? req.map(one).reverse() : one(req));
  };
  const rpc = RPC.createRpcClient({ url: 'https://rpc.invalid/', fetch: mockFetch, headers: { 'x-test': '1' } });
  eq('rpc chainId', await rpc.chainId(), 11155111);
  eq('rpc request raw', await rpc.request('eth_blockNumber'), '0x10');
  eq('rpc getBalance', await rpc.getBalance(ADDR0), 10n ** 18n);
  eq('rpc request shape', [sent[2].req.method, sent[2].req.params, sent[2].req.jsonrpc, sent[2].init.method, sent[2].init.headers['x-test']], ['eth_getBalance', [ADDR0, 'latest'], '2.0', 'POST', '1']);
  try { await rpc.call({ to: ADDR1, data: '0x1234', value: 5n }); fail++; console.log('FAIL rpc error: no error'); } catch (e) {
    eq('rpc error code / data', [e.code, e.data, ABI.decodeErrorResult(null, e.data).reason], [3, revert, 'Not enough']);
  }
  eq('rpc call params', sent[3].req.params, [{ to: ADDR1, value: '0x5', data: '0x1234' }, 'latest']);
  const batch = await rpc.batch([['eth_chainId', []], ['eth_nope', []], ['eth_blockNumber', []]]);
  eq('rpc batch', [batch[0], batch[1] instanceof Error && batch[1].code, batch[2]], ['0xaa36a7', -32601, '0x10']);
  const fh = await rpc.feeHistory(1, 'latest', [10, 50, 90]);
  eq('rpc feeHistory', [fh.oldestBlock, fh.baseFeePerGas, fh.reward], [1n, [10n ** 9n, 10n ** 9n], [[1n, 2n, 3n]]]);
  const rc = await rpc.getTransactionReceipt('0x' + 'ab'.repeat(32));
  eq('rpc receipt', [rc.status, rc.gasUsed, rc.blockNumber, rc.logs[0].logIndex, rc.logs[0].address], [1, 21000n, 16n, 2, ADDR0]);
  const slow = RPC.createRpcClient({ url: 'https://rpc.invalid/', timeout: 20, fetch: (u, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  await rejects('rpc timeout', slow.blockNumber(), 'TIMEOUT');
  await rejects('rpc http error', RPC.createRpcClient({ url: 'x', fetch: async () => answer('Bad Gateway', 502) }).blockNumber(), 'HTTP');
  await rejects('rpc network error', RPC.createRpcClient({ url: 'x', fetch: async () => { throw new Error('down'); } }).blockNumber(), 'NETWORK');
  eq('rpc ONLINE', [RPC.ONLINE, OFF.ONLINE], [true, false]);
  eq('rpc offline exports', Object.keys(OFF).sort(), Object.keys(RPC).sort());
  const off = OFF.createRpcClient({ url: 'https://rpc.invalid/' });
  eq('rpc offline methods', Object.keys(off).sort(), Object.keys(rpc).sort());
  for (const m of Object.keys(off).filter((k) => k !== 'url')) await rejects(`rpc offline ${m}`, off[m](), 'OFFLINE');
  const offText = fs.readFileSync(path.join(HERE, 'rpc.offline.js'), 'utf8') + fs.readFileSync(path.join(HERE, 'rpc-format.js'), 'utf8');
  eq('rpc offline has no network API', /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(offText), false);
  eq('rpc blockTag', [RPC.blockTag(16), RPC.blockTag('safe'), RPC.blockTag(255n)], ['0x10', 'safe', '0xff']);

  // --- chains ------------------------------------------------------------------------------------------------------------
  const ids = [1, 11155111, 17000, 560048, 10, 42161, 8453, 137, 324, 59144, 534352, 100, 56, 43114, 11155420, 421614, 84532, 31337, 1337];
  eq('chains present', ids.every((id) => C.chainById(id)), true);
  eq('chains unique', [new Set(C.CHAINS.map((c) => c.id)).size, new Set(C.CHAINS.map((c) => c.short)).size], [C.CHAINS.length, C.CHAINS.length]);
  eq('chains shape', C.CHAINS.every((c) => c.name && c.short && c.currency.decimals === 18 && c.rpc.length && c.rpc.every((u) => /^https?:\/\//.test(u)) && typeof c.testnet === 'boolean' && typeof c.l2 === 'boolean' && typeof c.eip1559 === 'boolean'), true);
  eq('chainName', [C.chainName(1), C.chainName(8453), C.chainName(999999)], ['Ethereum', 'Base', 'Chain 999999']);
  eq('chain flags', [C.chainById(11155111).testnet, C.chainById(42161).l2, C.chainById(1).l2, C.chainById(137).currency.symbol], [true, true, false, 'POL']);
  eq('explorerUrl', C.explorerUrl(1, 'tx', '0xabc'), 'https://etherscan.io/tx/0xabc');
  eq('chainByShortName', C.chainByShortName('arb1').id, 42161);

  // --- logs ----------------------------------------------------------------------------------------------------------------
  const KNOWN_TOPICS = {
    'Transfer(address,address,uint256)': '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    'Approval(address,address,uint256)': '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    'ApprovalForAll(address,address,bool)': '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
    'TransferSingle(address,address,address,uint256,uint256)': '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    'TransferBatch(address,address,address,uint256[],uint256[])': '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
    'Deposit(address,uint256)': '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
    'Withdrawal(address,uint256)': '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
    'Swap(address,uint256,uint256,uint256,uint256,address)': '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
    'Sync(uint112,uint112)': '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',
    'Swap(address,address,int256,int256,uint160,uint128,int24)': '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  };
  for (const [sig, topic] of Object.entries(KNOWN_TOPICS)) eq(`topic ${sig}`, ABI.eventTopic(sig), topic);
  const TOKEN = '0x' + 'cc'.repeat(20);
  const nft = { address: TOKEN, topics: [KNOWN_TOPICS['Transfer(address,address,uint256)'], pad(A.ZERO_ADDRESS), pad(ADDR1), pad('0x2a')], data: '0x', logIndex: 3 };
  const batchLog = { address: TOKEN, topics: [KNOWN_TOPICS['TransferBatch(address,address,address,uint256[],uint256[])'], pad(ADDR0), pad(ADDR0), pad(ADDR1)], data: ABI.encodeParameters(['uint256[]', 'uint256[]'], [[1, 2], [10, 20]]), logIndex: 4 };
  const swap = { address: TOKEN, topics: [KNOWN_TOPICS['Swap(address,address,int256,int256,uint160,uint128,int24)'], pad(ADDR0), pad(ADDR1)], data: ABI.encodeParameters(['int256', 'int256', 'uint160', 'uint128', 'int24'], [-5, 7, 1, 2, -3]) };
  const unknown = { address: TOKEN, topics: ['0x' + '99'.repeat(32)], data: '0x' };
  const logs = [{ ...t20, address: TOKEN, logIndex: 1 }, nft, batchLog, swap, unknown];
  const dl = L.decodeLogs(logs);
  eq('decodeLogs', dl.map((d) => (d.unknown ? 'unknown' : `${d.standard}:${d.name}`)), ['erc20:Transfer', 'erc721:Transfer', 'erc1155:TransferBatch', 'uniswap-v3:Swap', 'unknown']);
  eq('decodeLogs v3 amounts', [dl[3].args.amount0, dl[3].args.tick], [-5n, -3n]);
  eq('decodeLogs extra ABI first', L.decodeLogs([unknown], ['event Mystery()']).map((d) => d.unknown), [true]);
  eq('tokenTransfersOf', L.tokenTransfersOf({ logs }), [
    { standard: 'erc20', token: A.getAddress(TOKEN), from: ADDR0, to: ADDR1, amount: 1000n, logIndex: 1 },
    { standard: 'erc721', token: A.getAddress(TOKEN), from: A.ZERO_ADDRESS, to: ADDR1, tokenId: 42n, logIndex: 3 },
    { standard: 'erc1155', token: A.getAddress(TOKEN), operator: ADDR0, from: ADDR0, to: ADDR1, tokenId: 1n, amount: 10n, logIndex: 4 },
    { standard: 'erc1155', token: A.getAddress(TOKEN), operator: ADDR0, from: ADDR0, to: ADDR1, tokenId: 2n, amount: 20n, logIndex: 4 },
  ]);

  // --- HD accounts (Hardhat / Anvil development phrase) ---------------------------------------------------------------------
  const JUNK = 'test test test test test test test test test test test junk';
  const acc0 = HD.accountFromMnemonic(JUNK, '', 0);
  eq('hd account 0', [acc0.path, acc0.address, h(acc0.privateKey), acc0.publicKey.length], ["m/44'/60'/0'/0/0", ADDR0, K0, 65]);
  eq('hd account 1', HD.accountFromMnemonic(JUNK, '', 1).address, ADDR1);
  const root = HDKey.fromMasterSeed(mnemonicToSeed(JUNK));
  eq('hd deriveAccount', [HD.deriveAccount(root, 1).address, h(HD.deriveAccount(root, 1).privateKey)], [ADDR1, K1]);
  eq('hd paths', [HD.ethPath(3), HD.ethPath(3, 'ledger-live'), HD.ethPath(3, 'ledger-legacy')], ["m/44'/60'/0'/0/3", "m/44'/60'/3'/0/0", "m/44'/60'/0'/3"]);
  eq('hd ledger-live 0 = bip44 0', HD.deriveAccount(root, 0, 'ledger-live').address, ADDR0);
  throws('hd bad scheme', () => HD.ethPath(0, 'nope'));
  const chainXpub = root.derive("m/44'/60'/0'/0").neuter().xpub;
  eq('hd watch-only xpub', [HD.deriveAddressFromXpub(chainXpub, 0), HD.deriveAddressFromXpub(chainXpub, 1)], [ADDR0, ADDR1]);
  eq('hd watch-only account xpub', HD.deriveAddressFromXpub(root.derive("m/44'/60'/0'").neuter().xpub, 1, { path: '0' }), ADDR1);
  count('Hardhat dev accounts', 2);

  // --- fees ----------------------------------------------------------------------------------------------------------------
  const parent = (gasUsed) => ({ baseFeePerGas: 1000000000n, gasUsed, gasLimit: 30000000n });
  eq('basefee at target', F.nextBaseFee(parent(15000000n)), 1000000000n);
  eq('basefee full block', F.nextBaseFee(parent(30000000n)), 1125000000n);
  eq('basefee empty block', F.nextBaseFee(parent(0n)), 875000000n);
  eq('basefee half way', F.nextBaseFee(parent(22500000n)), 1062500000n);
  eq('basefee minimum increase', F.nextBaseFee({ baseFeePerGas: 7n, gasUsed: 15000001n, gasLimit: 30000000n }), 8n);
  eq('basefee hex input', F.nextBaseFee({ baseFeePerGas: '0x3b9aca00', gasUsed: '0x1c9c380', gasLimit: '0x1c9c380' }), 1125000000n);
  eq('basefee OP params', F.nextBaseFee(parent(30000000n), { elasticity: 6, denominator: 250 }), 1000000000n + 1000000000n * 25000000n / 5000000n / 250n);
  const hist = { baseFeePerGas: ['0x1', '0x2', '0x3b9aca00'], gasUsedRatio: [0.9, 0], reward: [['0x64', '0xc8', '0x12c'], ['0x0', '0x0', '0x0']] };
  eq('suggestFees', F.suggestFees(hist), { baseFee: 1000000000n, slow: { maxPriorityFeePerGas: 100n, maxFeePerGas: 2000000100n }, normal: { maxPriorityFeePerGas: 200n, maxFeePerGas: 2000000200n }, fast: { maxPriorityFeePerGas: 300n, maxFeePerGas: 2000000300n } });
  eq('suggestFees empty blocks', F.suggestFees({ baseFeePerGas: ['0x0', '0x64'], gasUsedRatio: [0], reward: [['0x0', '0x0', '0x0']] }, { baseFeeMultiplier: 1.5, fallbackPriorityFee: 5n }).fast, { maxPriorityFeePerGas: 5n, maxFeePerGas: 155n });
  eq('legacyGasPrice', F.legacyGasPrice(100n), { slow: { gasPrice: 100n }, normal: { gasPrice: 110n }, fast: { gasPrice: 125n } });
  eq('feeCost', F.feeCost(21000, { maxFeePerGas: 2n }), 42000n);

  console.log('ethereum vectors: ' + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log(`ethereum: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
