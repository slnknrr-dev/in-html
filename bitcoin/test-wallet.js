// bitcoin/test-wallet.js - the second suite of the bitcoin library (run by bitcoin/test.js): PSBTs (Core's
// rpc_psbt.json), descriptors (BIP-380 .. 387, 389), accounts (BIP-49 / 84 / 86 vectors), the script interpreter
// (Core's script_tests.json, 1258 cases with exact error names), message signatures (Core's vectors, BIP-322 basic and
// generated vectors), coin selection, fee estimates, spending end to end (build, sign, finalize, extract, verify with
// the interpreter for every address type), RBF / CPFP, BIP-21, BIP-329, units, blocks, and the Esplora, Core RPC and
// Electrum clients against mocked transports (no network).
//
// Mocked transports keep the suite deterministic and offline (no dependence on public servers, no leaking test
// addresses to them); randomized algorithms (knapsack, change position) get an injected rng for the same reason.
// End-to-end spends are verified with the interpreter rather than by comparing hex, so a signing bug cannot hide
// behind a wrong expected value.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '../crypto/encoding.js';
import { getPublicKey } from '../crypto/secp256k1.js';
import { HDKey } from '../hdkey/bip32.js';
import { mnemonicToSeed } from '../hdkey/bip39.js';
import { Psbt } from './psbt.js';
import { parseDescriptor, descriptorChecksum, deriveAddresses } from './descriptor.js';
import { Account, deriveAccount, deriveAddress } from './account.js';
import { decodeWIF, toOutputScript, fromOutputScript } from './address.js';
import * as S from './script.js';
import { FLAGS, parseFlags, verifyScript, txChecker, verifyInput, STANDARD_FLAGS } from './interpreter.js';
import { Transaction } from './tx.js';
import { taprootCommit } from './taproot.js';
import { signMessage, verifyMessage, bip322Sign, bip322Verify, bip322MessageHash, bip322ToSpend, bip322ToSign } from './message.js';
import { selectCoins } from './coinselect.js';
import { inputWeight, txVsize, dustThreshold, pickFeeRates } from './fees.js';
import { createSpend, bumpFee, cpfp } from './spend.js';
import { parseBitcoinURI, formatBitcoinURI } from './uri.js';
import { exportLabels, importLabels } from './labels.js';
import { parseBtc, formatBtc } from './units.js';
import { parseHeader, difficulty, checkProofOfWork, merkleRoot, merkleProof, verifyMerkleProof, bitsToTarget, targetToBits, blockSubsidy } from './block.js';
import { createEsploraClient } from './esplora.js';
import { createCoreRpc } from './rpc.js';
import { createElectrumClient, electrumScriptHash } from './electrum.js';
import { scanAccount, walletHistory, balanceSeries } from './sync.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Core's script test ASM (core_read.cpp ParseScript): numbers, 0x raw bytes, 'strings', opcode names.
function coreAsm(s) {
  const names = {};
  for (const [k, v] of Object.entries(S.OPS)) { if (v < 0x61 && v !== 0x50) continue; names[k] = v; names[k.slice(3)] = v; }
  names.NOP2 = 0xb1; names.NOP3 = 0xb2;
  const raw = (v) => (v.length < 0x4c ? concatBytes(Uint8Array.of(v.length), v) : v.length <= 0xff ? concatBytes(Uint8Array.of(0x4c, v.length), v) : concatBytes(Uint8Array.of(0x4d, v.length & 0xff, v.length >> 8), v));
  const parts = [];
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (/^-?\d+$/.test(w)) {
      const n = BigInt(w);
      parts.push(n === 0n ? Uint8Array.of(0) : n === -1n || (n >= 1n && n <= 16n) ? Uint8Array.of(Number(n) + 0x50) : raw(S.scriptNumEncode(n)));
    } else if (/^0x[0-9a-fA-F]+$/.test(w)) parts.push(hexToBytes(w.slice(2)));
    else if (w.length >= 2 && w[0] === "'" && w.endsWith("'")) parts.push(raw(utf8ToBytes(w.slice(1, -1))));
    else if (w in names) parts.push(Uint8Array.of(names[w]));
    else throw new Error('bad token ' + w);
  }
  return concatBytes(...parts);
}

export async function run(V, harness) {
  const t = harness('bitcoin wallet');
  const hex = bytesToHex;

  // --- PSBT: Core's rpc_psbt.json ---
  const P = V.psbt;
  P.invalid.forEach((s, i) => t.throws(`psbt invalid #${i}`, () => Psbt.fromBase64(s)));
  P.invalid_with_msg.forEach(([s, msg]) => t.throws(`psbt invalid: ${msg}`, () => Psbt.fromBase64(s)));
  P.valid.forEach((s, i) => {
    let p;
    try { p = Psbt.fromBase64(s); } catch (e) { t.eq(`psbt valid #${i}`, e.message, 'parses'); return; }
    t.eq(`psbt valid #${i} stable`, Psbt.fromBase64(p.toBase64()).toBase64(), p.toBase64());
  });
  for (const c of P.creator) {
    const p = Psbt.create({ inputs: c.inputs, outputs: c.outputs.map((o) => { const [a, v] = Object.entries(o)[0]; return { address: a, value: Math.round(v * 1e8) }; }), network: 'regtest' });
    t.eq('psbt creator', p.toBase64(), c.result);
  }
  P.signer.forEach((s, k) => {
    const p = Psbt.fromBase64(s.psbt);
    const keys = s.privkeys.map((w) => { const d = decodeWIF(w); return { privateKey: d.privateKey, compressed: d.compressed }; });
    p.signAll(keys);
    t.eq(`psbt signer #${k}`, p.toBase64(), s.result);
  });
  for (const c of P.combiner) t.eq('psbt combiner', Psbt.combine(...c.combine.map((x) => Psbt.fromBase64(x))).toBase64(), c.result);
  for (const c of P.finalizer) { const p = Psbt.fromBase64(c.finalize); p.finalizeAll(); t.eq('psbt finalizer', p.toBase64(), c.result); }
  for (const c of P.extractor) t.eq('psbt extractor', Psbt.fromBase64(c.extract).extract().toHex(), c.result);
  // v0 <-> v2 conversion keeps the transaction.
  const p0 = Psbt.fromBase64(P.creator[0].result);
  const p2 = p0.toVersion(2);
  t.eq('psbt v2 txid', [p2.version, p2.txid()], [2, p0.txid()]);
  t.eq('psbt v2 round trip', Psbt.fromBase64(p2.toBase64()).toVersion(0).toBase64(), p0.toBase64());

  // --- descriptors ---
  for (const [bip, v] of Object.entries(V.descriptors)) {
    if (bip === 'bip380') continue;
    for (const d of v.valid) {
      try {
        const desc = parseDescriptor(d.desc);
        if (bip === 'bip389') { t.eq(`${bip} split ${d.desc.slice(0, 40)}`, desc.split().map((x) => x.toString({ checksum: false })), d.scripts); continue; }
        let got;
        if (d.children.length) got = d.children.map((_, i) => desc.expand(i).scripts.map(hex));
        else if (desc.isRange) got = d.scripts.map((_, i) => hex(desc.script(i)));
        else got = d.scripts.length ? desc.expand(0).scripts.map(hex) : d.scripts;
        t.eq(`${bip} ${d.desc.slice(0, 48)}`, got, d.children.length ? d.children : d.scripts);
      } catch (e) { t.eq(`${bip} ${d.desc.slice(0, 48)}`, e.message, 'valid'); }
    }
    for (const [d, why] of v.invalid) t.throws(`${bip} invalid: ${why}`, () => parseDescriptor(d).expand(0));
  }
  const B = V.descriptors.bip380;
  const chk = (s) => { try { parseDescriptor(s); return true; } catch { return false; } };
  t.eq('bip380 checksums', B.checksums.map(([s]) => chk(s)), [true, true, false, false, false, false, false, false]);
  for (const k of B.validKeys) t.ok(`bip380 key ${k.slice(0, 30)}`, chk(`pkh(${k})`));
  for (const [k, why] of B.invalidKeys) t.eq(`bip380 invalid key: ${why}`, chk(`pkh(${k})`), false);
  t.eq('descriptor checksum', descriptorChecksum('raw(deadbeef)'), '89f8spxm');
  const pubForm = parseDescriptor('wpkh([ffffffff/13h]xprv9vHkqa6EV4sPZHYqZznhT2NPtPCjKuDKGY38FBWLvgaDx45zo9WQRUT3dKYnjwih2yJD9mkrocEZXo1ex8G81dwSM1fwqWpWkeS3v86pgKt/1/2/*)').toString({ public: true, checksum: false });
  t.eq('descriptor public form', pubForm, 'wpkh([ffffffff/13h]xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH/1/2/*)');

  // --- accounts: BIP-49 / BIP-84 / BIP-86 vectors ---
  const master = HDKey.fromMasterSeed(mnemonicToSeed(ABANDON));
  const a84 = deriveAccount(master, { type: 'p2wpkh' });
  t.eq('bip84 addresses', [a84.address(0, 0), a84.address(0, 1), a84.address(1, 0)], ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el']);
  t.eq('bip84 zpub', a84.slip132, 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  const a86 = deriveAccount(master, { type: 'p2tr' });
  t.eq('bip86 addresses', [a86.address(0, 0), a86.address(0, 1), a86.address(1, 0)], ['bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', 'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh', 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7']);
  const a49 = deriveAccount(master, { type: 'p2sh-p2wpkh', network: 'testnet' });
  t.eq('bip49 address', a49.address(0, 0), '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2');
  t.eq('bip49 upub', a49.slip132, 'upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY');
  const a44 = deriveAccount(master, { type: 'p2pkh' });
  t.eq('bip44 address', a44.address(0, 0), '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  const w84 = Account.fromExtendedKey(a84.slip132);
  t.eq('watch-only zpub', [w84.type, w84.address(0, 1), w84.address(1, 0)], ['p2wpkh', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el']);
  const dAcc = Account.fromDescriptors(a84.descriptor());
  t.eq('account from multipath descriptor', [dAcc.address(0, 0), dAcc.address(1, 0), dAcc.fingerprint], ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el', master.fingerprint]);
  t.ok('account descriptor', /^wpkh\(\[73c5da0a\/84h\/0h\/0h\]xpub.+\/<0;1>\/\*\)#[a-z0-9]{8}$/.test(a84.descriptor()));
  t.eq('deriveAddress zpub', [deriveAddress(a84.slip132, 1), deriveAddress(a84.slip132, 0, 'mainnet', { chain: 1 })], ['bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el']);
  t.eq('deriveAddress descriptor', [deriveAddress(a84.descriptor(), 1), deriveAddress(a84.descriptor(), 0, 'mainnet', { chain: 1 })], ['bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el']);
  t.eq('deriveAddress taproot xpub', deriveAddress(a86.xpub, 0, 'mainnet', { type: 'p2tr' }), 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  t.eq('deriveAddress address', deriveAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 5), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  t.throws('deriveAddress wrong network', () => deriveAddress(a84.slip132, 0, 'testnet'));
  t.throws('deriveAddress private descriptor', () => deriveAddress('wpkh(L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1)', 0));
  t.eq('derive addresses',deriveAddresses(a84.descriptor().replace('<0;1>', '0').replace(/#.*$/, ''), 0, 2), ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g']);

  // --- interpreter: Core's script_tests.json ---
  const st = JSON.parse(fs.readFileSync(path.join(HERE, 'script-tests.json'), 'utf8'));
  const key0 = getPublicKey(1n).subarray(1);
  let stOk = 0, stCount = 0;
  const stBad = [];
  for (const test of st) {
    if (test.length < 4) continue;
    let pos = 0, witness = [], amount = 0, leaf = null;
    if (Array.isArray(test[0])) {
      const w = test[0];
      for (let i = 0; i < w.length - 1; i++) {
        if (w[i].startsWith('#SCRIPT#')) witness.push(coreAsm(w[i].slice(8)));
        else if (w[i] === '#CONTROLBLOCK#') { leaf = witness[witness.length - 1]; witness.push(taprootCommit(key0, { script: leaf }).leaves[0].controlBlock); }
        else witness.push(hexToBytes(w[i]));
      }
      amount = Math.round(w[w.length - 1] * 1e8);
      pos = 1;
    }
    if (test.length < pos + 4) continue;
    stCount++;
    const sig = coreAsm(test[pos]);
    const spk = test[pos + 1] === '0x51 0x20 #TAPROOTOUTPUT#' ? taprootCommit(key0, { script: leaf }).script : coreAsm(test[pos + 1]);
    let flags = parseFlags(test[pos + 2].replace('NONE', ''));
    if (flags & FLAGS.CLEANSTACK) flags |= FLAGS.P2SH | FLAGS.WITNESS;
    const credit = new Transaction({ version: 1, inputs: [{ txid: '0'.repeat(64), vout: 0xffffffff, scriptSig: Uint8Array.of(0, 0) }], outputs: [{ value: amount, script: spk }] });
    const spend = new Transaction({ version: 1, inputs: [{ txid: credit.txid(), vout: 0, scriptSig: sig, witness }], outputs: [{ value: amount, script: new Uint8Array(0) }] });
    const r = verifyScript(sig, spk, witness, flags, txChecker(spend, 0, [{ value: amount, script: spk }], amount));
    if ((r.ok ? 'OK' : r.error) === test[pos + 3]) stOk++; else stBad.push(`${test[pos + 3]} got ${r.error}: ${JSON.stringify(test).slice(0, 80)}`);
  }
  t.eq(`core script_tests.json (${stCount} with exact errors)`, [stOk, stBad.slice(0, 3)], [stCount, []]);

  // --- messages: Bitcoin Core vectors ---
  const trust = hexToBytes('d97f5108f11cda6eeebaaa420fef0726b1f898060b98489fa3098463c0032866');
  t.eq('core message_sign', signMessage('Trust no one', trust), 'IPojfrX2dfPnH26UegfbGQQLrdK844DlHq5157/P6h57WyuS/Qsl+h/WSVGDF4MUi4rWSswW38oimDYfNNUBUOk=');
  t.eq('core message_verify ok', verifyMessage('Trust no one', '15CRxFdyRpGZLW9w8HnHvVduizdL5jKNbs', 'IPojfrX2dfPnH26UegfbGQQLrdK844DlHq5157/P6h57WyuS/Qsl+h/WSVGDF4MUi4rWSswW38oimDYfNNUBUOk=').valid, true);
  t.eq('core message_verify not signed', verifyMessage('I never signed this', '15CRxFdyRpGZLW9w8HnHvVduizdL5jKNbs', 'IPojfrX2dfPnH26UegfbGQQLrdK844DlHq5157/P6h57WyuS/Qsl+h/WSVGDF4MUi4rWSswW38oimDYfNNUBUOk=').valid, false);
  t.eq('core message_verify uncompressed', verifyMessage('Trust me', '11canuhp9X2NocwCq7xNrQYTmUgZAnLK3', 'IIcaIENoYW5jZWxsb3Igb24gYnJpbmsgb2Ygc2Vjb25kIGJhaWxvdXQgZm9yIGJhbmtzIAaHRtbCeDZINyavx14=').valid, true);
  t.eq('core message_verify invalid address', verifyMessage('message too', 'invalid address', 'signature should be irrelevant').valid, false);
  t.eq('core message_verify no pubkey', verifyMessage('x', '1KqbBpLy5FARmTPD4VZnDDpYjkUvkr82Pm', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=').valid, false);
  const wk = decodeWIF('cUeKHd5orzT3mz8P9pxyREHfsWtVfgsfDjiZZBcjUBAaGk1BTj7N');
  t.eq('core signmessagewithprivkey', signMessage('This is just a test message', wk.privateKey), 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=');
  t.eq('core verifymessage testnet', verifyMessage('This is just a test message', 'mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB', 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=').valid, true);
  // BIP-137 segwit headers round trip.
  for (const type of ['p2sh-p2wpkh', 'p2wpkh']) {
    const acc = type === 'p2wpkh' ? a84 : deriveAccount(master, { type });
    const priv = master.derive(acc.path + '/0/0').privateKey;
    const sig = signMessage('hello', priv, { type });
    t.eq(`bip137 ${type}`, verifyMessage('hello', acc.address(0, 0), sig).valid, true);
  }

  // --- BIP-322 ---
  for (const h of V.bip322.basic.tx_hashes) {
    t.eq(`bip322 message hash "${h.message.slice(0, 12)}"`, hex(bip322MessageHash(h.message)), h.message_hash);
    const ts = bip322ToSpend(toOutputScript(h.address), h.message);
    t.eq('bip322 to_spend', ts.txid(), h.to_spend_tx_hash);
    t.eq('bip322 to_sign', bip322ToSign(ts.txid()).txid(), h.to_sign_tx_hash);
  }
  for (const group of [V.bip322.basic, V.bip322.generated]) {
    for (const kind of ['simple', 'full', 'proof_of_funds']) {
      for (const v of group[kind] || []) {
        for (const sig of v.bip322_signatures) {
          const r = bip322Verify(v.message, v.address, sig);
          t.eq(`bip322 ${kind} ${v.type} verify ${sig.slice(0, 10)}`, [r.valid, r.error || null], [true, null]);
        }
        // Our own signature for the single-key types verifies too (and equals one of the vectors' when deterministic).
        if (v.private_keys.length === 1 && ['p2wpkh', 'p2tr', 'p2pkh', 'p2sh-p2wpkh'].includes(v.type) && !v.tx_version) {
          const k = decodeWIF(v.private_keys[0]);
          const ours = bip322Sign(v.message, k.privateKey, v.address);
          t.eq(`bip322 ${kind} ${v.type} sign`, bip322Verify(v.message, v.address, ours).valid, true);
          if (v.type === 'p2wpkh' && group === V.bip322.basic) t.ok(`bip322 ${v.type} deterministic (low R like Core)`, v.bip322_signatures.includes(ours));
        }
      }
    }
    for (const e of group.error || []) {
      const r = bip322Verify(e.message, e.address, e.signature);
      t.eq(`bip322 error: ${e.description}`, [r.valid, String(r.error).includes(e.error_substr)], [false, true]);
    }
  }

  // --- coin selection and fees ---
  t.eq('input weights', ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'].map((x) => inputWeight(x)), [592, 364, 272, 230]);
  t.eq('dust', ['76a914' + '00'.repeat(20) + '88ac', '0014' + '00'.repeat(20), '5120' + '00'.repeat(32), 'a914' + '00'.repeat(20) + '87', '6a00'].map((h) => dustThreshold(hexToBytes(h))), [546, 294, 330, 540, 0]);
  t.eq('vsize 1 in 2 out p2wpkh', txVsize({ inputs: ['p2wpkh'], outputs: [22, 22] }), 141);
  t.eq('fee rates', pickFeeRates({ 1: 30, 2: 25, 3: 20, 6: 10, 144: 3, 1008: 1 }), { fastest: 30, halfHour: 20, hour: 10, economy: 3, minimum: 1 });
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const coins = [10000, 20000, 50000, 100000, 1000000, 2500].map((value, i) => ({ value, type: 'p2wpkh', id: i }));
  const baseWeight = (4 + 4 + 1 + 1) * 4 + 31 * 4 + 2;
  const exact = selectCoins({ utxos: coins, target: 70000 - 68 * 2 - 11 - 31 - 1, feeRate: 1, baseWeight, rng });
  t.eq('bnb changeless', [exact.algorithm, exact.change, exact.inputs.map((c) => c.id).sort()], ['bnb', 0, [1, 2]]);
  const withChange = selectCoins({ utxos: coins, target: 123456, feeRate: 5, baseWeight, rng });
  t.ok('selection with change', withChange.change >= 294 && withChange.inputs.reduce((s, c) => s + c.value, 0) === 123456 + withChange.fee + withChange.change);
  t.throws('insufficient', () => selectCoins({ utxos: coins, target: 5000000, feeRate: 1, baseWeight, rng }));
  const forced = selectCoins({ utxos: coins, include: [coins[5]], target: 1000, feeRate: 1, baseWeight, rng });
  t.ok('coin control include', forced.inputs.includes(coins[5]));

  // --- spending end to end on regtest: every single-key type, signed, finalized, verified by the interpreter ---
  const net = 'regtest';
  const types = ['p2wpkh', 'p2sh-p2wpkh', 'p2tr', 'p2pkh'];
  const accounts = Object.fromEntries(types.map((ty) => [ty, deriveAccount(master, { type: ty, network: net })]));
  const fakePrev = (script, value, n) => new Transaction({ version: 2, inputs: [{ txid: n.toString(16).padStart(64, '0'), vout: 0, sequence: 0xffffffff }], outputs: [{ value, script }] });
  const utxos = types.map((ty, n) => {
    const info = accounts[ty].spendInfo(0, n);
    const prev = fakePrev(info.script, 40000 + n * 1000, n + 1);
    return { txid: prev.txid(), vout: 0, value: prev.outputs[0].value, script: info.script, spendInfo: info, prevTx: prev };
  });
  const change = accounts.p2wpkh.spendInfo(1, 0);
  const spend = createSpend({ utxos, recipients: [{ address: accounts.p2tr.address(0, 9), value: 150000 }], feeRate: 2, change, network: net, rng });
  const signedCount = spend.psbt.signAll(master);
  t.eq('spend signatures', signedCount, spend.inputs.length);
  t.ok('spend signatures valid', spend.psbt.inputs.every((_, i) => spend.psbt.validateSignatures(i)));
  t.ok('spend finalize', spend.psbt.finalizeAll());
  const tx = spend.psbt.extract();
  const prevouts = spend.inputs.map((u) => ({ value: u.value, script: u.script }));
  t.eq('spend inputs verify', tx.inputs.map((_, i) => verifyInput(tx, i, prevouts, STANDARD_FLAGS).error), tx.inputs.map(() => null));
  t.ok('spend fee estimate', Math.abs(tx.vsize() - spend.vsize) <= tx.inputs.length && spend.fee >= tx.vsize() * 2 - 2);
  t.ok('spend rbf', tx.signalsRbf());
  // Send max.
  const max = createSpend({ utxos: utxos.slice(0, 2), recipients: [{ address: accounts.p2wpkh.address(0, 5), max: true }], feeRate: 3, network: net });
  t.eq('send max', [max.outputs.length, max.outputs[0].value + max.fee], [1, utxos[0].value + utxos[1].value]);
  // RBF bump: same inputs, smaller change, BIP-125 rule 4.
  const ci = spend.change.index;
  const bumped = bumpFee({ psbt: spend.psbt, spent: spend.inputs, newFeeRate: 10, changeIndex: ci, change, network: net });
  t.ok('rbf bump fee', bumped.fee >= spend.fee + bumped.vsize && bumped.feeRate >= 10);
  t.eq('rbf same inputs', bumped.psbt.tx().inputs.map((i) => i.txid + i.vout), tx.inputs.map((i) => i.txid + i.vout));
  bumped.psbt.signAll(master); bumped.psbt.finalizeAll();
  const btx = bumped.psbt.extract();
  t.eq('rbf verifies', btx.inputs.map((_, i) => verifyInput(btx, i, prevouts).error), btx.inputs.map(() => null));
  // CPFP on the change output.
  const child = cpfp({ parent: { txid: tx.txid(), vsize: tx.vsize(), fee: spend.fee }, utxos: [{ txid: tx.txid(), vout: ci, value: tx.outputs[ci].value, script: change.script, spendInfo: change }], feeRate: 20, destination: accounts.p2wpkh.spendInfo(0, 7), network: net });
  t.ok('cpfp package rate', child.packageFeeRate >= 19.9);

  // --- BIP-21 (the BIP's examples; their address 175tWpb8… has no valid Base58Check checksum) ---
  const NOCHECK = { validateAddress: false };
  t.throws('bip21 example address checksum', () => parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W'));
  const u1 = parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz', NOCHECK);
  t.eq('bip21 parse', [u1.address, u1.amount, u1.label, u1.message], ['175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W', 5000000000, 'Luke-Jr', 'Donation for project xyz']);
  t.eq('bip21 amount', parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr', NOCHECK).amount, 2030000000);
  t.throws('bip21 req-', () => parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999', NOCHECK));
  t.eq('bip21 unknown optional', parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?somethingyoudontunderstand=50&somethingelseyoudontget=999', NOCHECK).params, { somethingyoudontunderstand: '50', somethingelseyoudontget: '999' });
  t.eq('bip21 format', formatBitcoinURI({ address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amount: 12345, label: 'A & B' }), 'bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.00012345&label=A%20%26%20B');
  t.eq('bip21 qr', formatBitcoinURI({ address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' }, { qr: true }), 'BITCOIN:BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU');
  t.eq('bip21 case-insensitive', parseBitcoinURI('BITCOIN:BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU').address, 'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU');
  t.throws('bip21 bad amount', () => parseBitcoinURI('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=1e3', NOCHECK));

  // --- BIP-329 (the BIP's example records) ---
  const lines = [
    '{ "type": "tx", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd", "label": "Transaction", "origin": "wpkh([d34db33f/84\'/0\'/0\'])" }',
    '{ "type": "addr", "ref": "bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c", "label": "Address" }',
    '{ "type": "pubkey", "ref": "0283409659355b6d1cc3c32decd5d561abaac86c37a353b52895a5e6c196d6f448", "label": "Public Key" }',
    '{ "type": "input", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:0", "label": "Input" }',
    '{ "type": "output", "ref": "f91d0a8a78462bc59398f2c5d7a84fcff491c26ba54c4833478b202796c8aafd:1", "label": "Output" , "spendable" : false }',
    '{ "type": "xpub", "ref": "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8", "label": "Extended Public Key" }',
    '{ "type": "tx", "ref": "f546156d9044844e02b181026a1a407abfca62e7ea1159f87bbeaa77b4286c74", "label": "Account #1 Transaction", "origin": "wpkh([d34db33f/84\'/0\'/1\'])" }',
    'not json', '{ "type": "addr", "ref": "bc1qinvalid" }',
  ].join('\n');
  const imp = importLabels(lines);
  t.eq('bip329 import', [imp.records.length, imp.errors.map((e) => e.line)], [7, [8, 9]]);
  t.eq('bip329 round trip', importLabels(exportLabels(imp.records)).records, imp.records);
  t.eq('bip329 truncate', importLabels('{"type":"tx","ref":"' + 'a'.repeat(64) + '","label":"' + 'x'.repeat(300) + '"}').records[0].label.length, 255);

  // --- units ---
  t.eq('parse btc', ['1', '0.00000001', '21000000', '0.1', '1,5', '.5'].map((s) => parseBtc(s)), [100000000, 1, 2100000000000000, 10000000, 150000000, 50000000]);
  t.throws('9 decimals', () => parseBtc('0.000000001'));
  t.throws('above max money', () => parseBtc('21000000.00000001'));
  t.eq('format btc', [formatBtc(123456789), formatBtc(100000000), formatBtc(5, { unit: 'sat' }), formatBtc(150000, { unit: 'mBTC' })], ['1.23456789', '1', '5', '1.5']);

  // --- blocks: the genesis block header ---
  const g = parseHeader('0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c');
  t.eq('genesis hash', g.hash, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
  t.eq('genesis merkle root', merkleRoot([g.merkleRoot]), '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
  t.eq('genesis pow', [checkProofOfWork(g), difficulty(g.bits), targetToBits(bitsToTarget(0x1d00ffff))], [true, 1, 0x1d00ffff]);
  const ids = Array.from({ length: 7 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
  t.ok('merkle proof', ids.every((id, i) => verifyMerkleProof(id, merkleProof(ids, i), i, merkleRoot(ids))));
  t.eq('subsidy', [blockSubsidy(0), blockSubsidy(210000), blockSubsidy(840000)], [5000000000, 2500000000, 312500000]);

  // --- clients against mocked transports ---
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push([url, opts.method]);
    const body = url.endsWith('/blocks/tip/height') ? '850000' : url.endsWith('/fee-estimates') ? '{"1":12.5,"6":4}' : url.includes('/v1/fees/recommended') ? null : '{"txid":"ab"}';
    return { ok: body !== null, status: body === null ? 404 : 200, text: async () => body || 'not found', json: async () => JSON.parse(body), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const es = createEsploraClient({ url: 'https://example.invalid/api/', fetch: fakeFetch });
  t.eq('esplora tip', await es.tipHeight(), 850000);
  t.eq('esplora fees', await es.feeEstimates(), { 1: 12.5, 6: 4 });
  t.eq('esplora optional endpoint', await es.recommendedFees(), null);
  await es.broadcast('00');
  t.eq('esplora urls', calls.map((c) => c.join(' ')), ['https://example.invalid/api/blocks/tip/height GET', 'https://example.invalid/api/fee-estimates GET', 'https://example.invalid/api/v1/fees/recommended GET', 'https://example.invalid/api/tx POST']);
  const rpcSeen = [];
  const rpc = createCoreRpc({ url: 'http://127.0.0.1:18443', user: 'u', password: 'p', fetch: async (url, opts) => {
    rpcSeen.push([url, opts.headers.Authorization, JSON.parse(opts.body)]);
    const req = JSON.parse(opts.body);
    const res = Array.isArray(req) ? req.map((r) => ({ id: r.id, result: r.method === 'getblockcount' ? 101 : null, error: null })) : { id: req.id, result: req.method === 'getblockcount' ? 101 : null, error: req.method === 'bad' ? { code: -32601, message: 'Method not found' } : null };
    return { status: 200, text: async () => JSON.stringify(res) };
  } });
  t.eq('core rpc', [await rpc.getBlockCount(), rpcSeen[0][1]], [101, 'Basic ' + Buffer.from('u:p').toString('base64')]);
  let rpcErr = null;
  try { await rpc.call('bad'); } catch (e) { rpcErr = e.code; }
  t.eq('core rpc error', rpcErr, -32601);
  t.eq('core rpc wallet url', (await rpc.wallet('w1').getBlockCount(), rpcSeen[rpcSeen.length - 1][0]), 'http://127.0.0.1:18443/wallet/w1');
  // Electrum over a fake socket: server.version first, then the request.
  const written = [];
  const fakeNet = { connect(opts, cb) {
    const handlers = {};
    const sock = { setEncoding() {}, setKeepAlive() {}, on(ev, fn) { handlers[ev] = fn; }, destroy() {}, write(line) {
      written.push(JSON.parse(line));
      const m = JSON.parse(line);
      const result = m.method === 'server.version' ? ['Fulcrum 1.11', '1.4'] : m.method === 'blockchain.scripthash.get_balance' ? { confirmed: 5, unconfirmed: 0 } : null;
      setTimeout(() => handlers.data(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n'), 1);
    } };
    setTimeout(cb, 1);
    return sock;
  } };
  const el = createElectrumClient({ host: '127.0.0.1', port: 50001, net: fakeNet });
  const sh = electrumScriptHash(toOutputScript('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'));
  t.eq('electrum balance', await el.scripthashBalance(sh), { confirmed: 5, unconfirmed: 0 });
  t.eq('electrum session', written.map((w) => w.method), ['server.version', 'blockchain.scripthash.get_balance']);
  t.eq('electrum scripthash', electrumScriptHash(hexToBytes('76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac')), '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161');
  el.close();

  // --- wallet sync against a mocked source ---
  const ownAddr = a84.address(0, 1);
  const fundTx = { txid: 'f'.repeat(64), status: { confirmed: true, block_height: 100, block_time: 1700000000 }, fee: 141, weight: 561, vin: [{ prevout: { scriptpubkey: '0014' + '11'.repeat(20), value: 60000 }, sequence: 0xfffffffd }], vout: [{ scriptpubkey: bytesToHex(a84.script(0, 1)), value: 50000 }, { scriptpubkey: '0014' + '22'.repeat(20), value: 9859 }] };
  const source = {
    async address(a) { return { chain_stats: a === ownAddr ? { tx_count: 1, funded_txo_sum: 50000, spent_txo_sum: 0 } : { tx_count: 0 }, mempool_stats: { tx_count: 0 } }; },
    async addressTxs(a) { return a === ownAddr ? [fundTx] : []; },
    async addressUtxos(a) { return a === ownAddr ? [{ txid: fundTx.txid, vout: 0, value: 50000, status: { confirmed: true, block_height: 100 } }] : []; },
    async tipHeight() { return 105; },
  };
  const scan = await scanAccount(w84, source, { gapLimit: 5 });
  t.eq('sync scan', [scan.balance.total, scan.next, scan.utxos.length, scan.addresses.length], [50000, { receive: 2, change: 0 }, 1, 12]);
  const hist = walletHistory(scan.txs, new Set(scan.addresses.map((a) => bytesToHex(w84.script(a.chain, a.index)))));
  t.eq('sync history', [hist[0].type, hist[0].net, hist[0].fee], ['receive', 50000, null]);
  t.eq('balance series', balanceSeries(hist).map((p) => p.balance), [50000]);

  console.log(`bitcoin wallet: ${t.pass} passed, ${t.fail} failed`);
  return t.fail;
}
