// bitcoin/test.js - unit tests of the bitcoin library: `node bitcoin/test.js` (or `node check.js tests bitcoin`).
// Official vectors (test-vectors.json, sources listed there): Bitcoin Core key_io_valid / key_io_invalid (addresses,
// scripts and WIF keys of every network), BIP-350 segwit addresses, 100 of Core's 500 legacy sighash vectors, the
// BIP-143 examples, the BIP-341 wallet vectors (script trees, control blocks, key path sighashes and signatures),
// Core's rpc_psbt.json (BIP-174 / 370 / 371 / 373 valid and invalid PSBTs, creator, signer, combiner, finalizer,
// extractor), the descriptor vectors of BIP-380 .. 387 and 389, BIP-322 basic and generated vectors, Core's message
// signing vectors (util_tests.cpp, rpc_signmessagewithprivkey.py), the BIP-44 / 49 / 84 / 86 account vectors.
// Further suites are in test-wallet.js (coin selection, fees, RBF / CPFP, URIs, labels, units, clients).
//
// Why external vectors over self-written cases: a self-written expectation encodes the author's understanding, so a
// misread BIP passes its own tests. Core's and the BIPs' vectors encode consensus / reference behaviour; matching them
// byte for byte (including exact error names) is the only meaningful correctness claim for consensus-adjacent code.
// The harness compares JSON.stringify of results: simple, but key order matters, so expectations are built in the
// same shape as results.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';
import { ecdsaSign, schnorrSign, getPublicKey, Signature } from '../crypto/secp256k1.js';
import * as S from './script.js';
import { decodeAddress, decodeWIF, encodeWIF, fromOutputScript, isValidAddress, toOutputScript, p2trAddress } from './address.js';
import { Transaction } from './tx.js';
import { reverseHex } from './bytes.js';
import { taprootCommit } from './taproot.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const CHAIN = { main: 'mainnet', test: 'testnet', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };

export function harness(label) {
  const t = { pass: 0, fail: 0 };
  t.eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) t.pass++;
    else { t.fail++; console.log(`FAIL ${label} ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  t.ok = (name, v) => t.eq(name, !!v, true);
  t.throws = (name, fn) => { try { fn(); t.fail++; console.log(`FAIL ${label} ${name}: no error`); } catch { t.pass++; } };
  return t;
}

export const loadVectors = () => JSON.parse(fs.readFileSync(path.join(HERE, 'test-vectors.json'), 'utf8'));

function coreTests(t, V) {
  const hex = bytesToHex;
  // Script basics.
  const asm = 'OP_DUP OP_HASH160 89abcdefabbaabbaabbaabbaabbaabbaabbaabba OP_EQUALVERIFY OP_CHECKSIG';
  t.eq('asm round trip', S.toAsm(S.fromAsm(asm)), asm);
  t.eq('push minimal', [hex(S.pushData(new Uint8Array(0))), hex(S.pushData(Uint8Array.of(5))), hex(S.pushData(Uint8Array.of(0x81))), hex(S.pushData(new Uint8Array(76))).slice(0, 4)], ['00', '55', '4f', '4c4c']);
  t.eq('script numbers', [-1, 0, 127, 128, -128, 255, 256, 2147483647].map((n) => hex(S.scriptNumEncode(n))), ['81', '', '7f', '8000', '8080', 'ff00', '0001', 'ffffff7f']);
  t.eq('script number decode', ['81', '', '7f', '8000', '8080', 'ff00', '0001', 'ffffff7f'].map((h) => S.scriptNumDecode(hexToBytes(h))), [-1, 0, 127, 128, -128, 255, 256, 2147483647]);
  t.throws('non-minimal number', () => S.scriptNumDecode(hexToBytes('0100')));
  t.eq('truncated asm', S.toAsm(hexToBytes('4c05ab')), '[error]');
  const ms = S.multisig(2, [getPublicKey(1n), getPublicKey(2n), getPublicKey(3n)]);
  t.eq('multisig parse', [S.classify(ms).type, S.parseMultisig(ms).m, S.parseMultisig(ms).n], ['multisig', 2, 3]);
  t.eq('classify', ['76a914' + '00'.repeat(20) + '88ac', 'a914' + '00'.repeat(20) + '87', '0014' + '00'.repeat(20), '0020' + '00'.repeat(32), '5120' + '00'.repeat(32), '6a0568656c6c6f', '51024e73', '5210' + '00'.repeat(16), 'ff']
    .map((h) => S.classify(hexToBytes(h)).type), ['p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr', 'nulldata', 'anchor', 'witness_unknown', 'nonstandard']);

  // Core key_io_valid / key_io_invalid.
  for (const [str, h, meta] of V.keyIoValid) {
    const net = CHAIN[meta.chain];
    if (meta.isPrivkey) {
      const d = decodeWIF(str, net);
      t.eq(`wif ${str.slice(0, 12)}`, [hex(d.privateKey), d.compressed], [h, meta.isCompressed]);
      t.eq(`wif encode ${str.slice(0, 12)}`, encodeWIF(hexToBytes(h), { compressed: meta.isCompressed, network: net }), str);
      t.eq(`wif is no address ${str.slice(0, 12)}`, isValidAddress(str), false);
    } else {
      t.eq(`address ${str.slice(0, 14)} (${net})`, hex(toOutputScript(str, net)), h);
      t.eq(`script -> ${str.slice(0, 14)} (${net})`, fromOutputScript(hexToBytes(h), net), meta.tryCaseFlip ? str.toLowerCase() : str);
      if (meta.tryCaseFlip) t.eq(`case flip ${str.slice(0, 14)}`, hex(toOutputScript(str.toUpperCase(), net)), h);
    }
  }
  for (const s of V.keyIoInvalid) {
    t.eq(`invalid address "${s.slice(0, 16)}"`, isValidAddress(s), false);
    t.throws(`invalid wif "${s.slice(0, 16)}"`, () => decodeWIF(s));
  }
  // BIP-350.
  for (const [a, h] of V.bip350Valid) t.eq(`bip350 ${a.slice(0, 16)}`, hex(toOutputScript(a)), h);
  for (const [a, why] of V.bip350Invalid) t.eq(`bip350 invalid: ${why}`, isValidAddress(a), false);
  t.eq('network of address', decodeAddress('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7').network, ['testnet', 'testnet4', 'signet']);
  t.throws('address of another network', () => toOutputScript('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'testnet'));

  // Core's legacy sighash vectors (results in display order).
  for (const [raw, script, index, hashType, want] of V.sighash) {
    const tx = Transaction.fromHex(raw);
    t.eq(`sighash ${want.slice(0, 12)}`, reverseHex(hex(tx.sighashLegacy(index, hexToBytes(script), hashType))), want);
    t.eq(`tx round trip ${want.slice(0, 12)}`, tx.toHex(), raw);
  }

  // BIP-143 examples: [unsigned tx #, input, scriptCode, amount, hashType, sigHash, private key?, signature?].
  const B143 = [
    [0, 1, '76a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac', 600000000, 1, 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670',
      '619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9', '304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee'],
    [1, 0, '76a91479091972186c449eb1ded22b78e40d009bdf008988ac', 1000000000, 1, '64f3b0f4dd2bb3aa1ce8566d220cc74dda9df97d8490cc81d89d735c92e59fb6'],
    [2, 1, '21026dccc749adc2a9d0d89497ac511f760f45c47dc5ed9cf352a58ac706453880aeadab210255a9626aebf5e29c0e6538428ba0d1dcf6ca98ffdf086aa8ced5e0d0215ea465ac', 4900000000, 3, '82dde6e4f1e94d02c2b7ad03d2115d691f48d064e9d52f58194a6637e4194391'],
    [2, 1, '210255a9626aebf5e29c0e6538428ba0d1dcf6ca98ffdf086aa8ced5e0d0215ea465ac', 4900000000, 3, 'fef7bd749cce710c5c052bd796df1af0d935e59cea63736268bcbe2d2134fc47'],
    [3, 0, '0063ab68210392972e2eb617b2388771abe27235fd5ac44af8e61693261550447a4c3e39da98ac', 16777215, 0x83, 'e9071e75e25b8a1e298a72f0d2e9f4f95a0f5cdf86a533cda597eb402ed13b3a'],
    [3, 1, '68210392972e2eb617b2388771abe27235fd5ac44af8e61693261550447a4c3e39da98ac', 16777215, 0x83, 'cd72f1f1a433ee9df816857fad88d8ebd97e09a75cd481583eb841c330275e54'],
    ...[[1, '185c0be5263dce5b4bb50a047973c1b6272bfbd0103a89444597dc40b248ee7c'], [2, 'e9733bc60ea13c95c6527066bb975a2ff29a925e80aa14c213f686cbae5d2f36'],
      [3, '1e1f1c303dc025bd664acb72e583e933fae4cff9148bf78c157d1e8f78530aea'], [0x81, '2a67f03e63a6a422125878b40b82da593be8d4efaafe88ee528af6e5a9955c6e'],
      [0x82, '781ba15f3779d5542ce8ecb5c18716733a5ee42a6f51488ec96154934e2c890a'], [0x83, '511e8e52ed574121fc1b654970395502128263f62662e076dc6baf05c2e6a99b']]
      .map(([ht, h]) => [4, 0, '56210307b8ae49ac90a048e9b53357a2354b3334e9c8bee813ecb98e99a7e07e8c3ba32103b28f0c28bfab54554ae8c658ac5c3e0ce6e79ad336331f78c428dd43eea8449b21034b8113d703413d57761b8b9781957b8c0ac1dfe69f492580ca4195f50376ba4a21033400f6afecb833092a9a21cfdf1ed1376e58c5d1f47de74683123987e967a8f42103a6d48b1131e94ba04d9737d61acdaa1322008af9602b3b14862c07a1789aac162102d8b661b0b3302ee2f162b09e07a55ad5dfbe673a9f01d9f0c19617681024306b56ae', 987654321, ht, h]),
    [5, 0, 'ad4830450220487fb382c4974de3f7d834c1b617fe15860828c7f96454490edd6d891556dcc9022100baf95feb48f845d5bfc9882eb6aeefa1bc3790e39f59eaa46ff7f15ae626c53e01', 200000, 1, '71c9cd9b2869b9c70b01b1f0360c148f42dee72297db312638df136f43311f23'],
  ];
  for (const [n, idx, code, amount, ht, want, priv, sig] of B143) {
    const tx = Transaction.fromHex(V.bip143.unsigned[n]);
    const h = tx.sighashV0(idx, hexToBytes(code), amount, ht);
    t.eq(`bip143 #${n} input ${idx} type ${ht}`, hex(h), want);
    if (priv) t.eq(`bip143 #${n} rfc6979 signature`, hex(ecdsaSign(h, hexToBytes(priv)).toDER()), sig);
  }
  for (const s of V.bip143.signed) {
    const tx = Transaction.fromHex(s);
    t.eq(`bip143 signed tx round trip ${s.slice(10, 22)}`, tx.toHex(), s);
    t.ok(`bip143 signed tx weight ${s.slice(10, 22)}`, tx.weight() < tx.size() * 4 && tx.vsize() === Math.ceil(tx.weight() / 4));
  }

  // BIP-341: script trees and key path spending.
  for (const v of V.bip341.scriptPubKey) {
    const toTree = (n) => (n == null ? null : Array.isArray(n) ? n.map(toTree) : { script: hexToBytes(n.script), leafVersion: n.leafVersion, id: n.id });
    const c = taprootCommit(hexToBytes(v.given.internalPubkey), toTree(v.given.scriptTree));
    const tag = `bip341 ${v.given.internalPubkey.slice(0, 8)}`;
    t.eq(tag + ' merkle root', c.merkleRoot ? hex(c.merkleRoot) : null, v.intermediary.merkleRoot);
    t.eq(tag + ' tweak', hex(c.tweak), v.intermediary.tweak);
    t.eq(tag + ' output key', hex(c.outputKey), v.intermediary.tweakedPubkey);
    t.eq(tag + ' script', hex(c.script), v.expected.scriptPubKey);
    t.eq(tag + ' address', fromOutputScript(c.script, 'mainnet'), v.expected.bip350Address);
    if (v.intermediary.leafHashes) {
      const byId = [...c.leaves].sort((a, b) => a.id - b.id);
      t.eq(tag + ' leaf hashes', byId.map((l) => hex(l.leafHash)), v.intermediary.leafHashes);
      t.eq(tag + ' control blocks', byId.map((l) => hex(l.controlBlock)), v.expected.scriptPathControlBlocks);
    }
    if (!v.given.scriptTree) t.eq(tag + ' p2trAddress', p2trAddress(hexToBytes(v.given.internalPubkey), 'mainnet'), v.expected.bip350Address);
  }
  for (const k of V.bip341.keyPathSpending) {
    const tx = Transaction.fromHex(k.given.rawUnsignedTx);
    const prevouts = k.given.utxosSpent.map((u) => ({ value: u.amountSats, script: hexToBytes(u.scriptPubKey) }));
    for (const s of k.inputSpending) {
      const g = s.given, im = s.intermediary;
      const tag = `bip341 key path input ${g.txinIndex} type ${g.hashType}`;
      t.eq(tag + ' sigMsg', hex(tx.sigMsgTaproot(g.txinIndex, prevouts, g.hashType)), im.sigMsg);
      t.eq(tag + ' sigHash', hex(tx.sighashTaproot(g.txinIndex, prevouts, g.hashType)), im.sigHash);
      const c = taprootCommit(getPublicKey(hexToBytes(g.internalPrivkey)), null);
      t.eq(tag + ' internal key', hex(c.internalKey), im.internalPubkey);
      // The vectors sign with aux_rand = 32 zero bytes; the tweaked private key is checked by crypto/test-ec.js.
      const tweaked = hexToBytes(im.tweakedPrivkey);
      const sig = schnorrSign(hexToBytes(im.sigHash), tweaked, new Uint8Array(32));
      t.eq(tag + ' witness', [hex(sig) + (g.hashType ? g.hashType.toString(16).padStart(2, '0') : '')], s.expected.witness);
    }
  }
  t.ok('Signature import', Signature);
}

export async function run() {
  const V = loadVectors();
  const t = harness('bitcoin');
  coreTests(t, V);
  console.log(`bitcoin: ${t.pass} passed, ${t.fail} failed`);
  const { run: runWallet } = await import('./test-wallet.js');
  return t.fail + (await runWallet(V, harness));
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
