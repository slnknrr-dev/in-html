// hdkey/test.js - unit tests of the hdkey library: `node hdkey/test.js` (or `node check.js tests hdkey`).
// Official vectors (test-vectors.json): BIP-32 test vectors 1-5 (derivation, serialisation, the 16 invalid keys),
// the BIP-39 reference vectors of Trezor (all English ones, the first ones of every other official list, passphrase
// "TREZOR"), the Japanese vectors of bip32JP (NFKD normalisation), the SHA-256 of every official word list.
// BIP-49 / BIP-84 / BIP-86 account keys of the "abandon … about" phrase (SLIP-132 ypub / zpub, the BIPs' vectors).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '../crypto/encoding.js';
import {
  WORDLISTS, checkMnemonic, completeWord, entropyToMnemonic, expandWords, generateMnemonic, mnemonicToEntropy,
  mnemonicToSeed, mnemonicToSeedAsync, validateMnemonic, wordlistOf,
} from './bip39.js';
import { HARDENED, HDKey, convertExtendedKey, extendedKeyPrefix, fingerprintHex, formatPath, parsePath, VERSIONS } from './bip32.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch { pass++; } };
  const V = JSON.parse(fs.readFileSync(path.join(HERE, 'test-vectors.json'), 'utf8'));

  // Word lists: the exact files of the BIP repository.
  for (const [name, list] of Object.entries(WORDLISTS)) {
    eq(`wordlist ${name}`, bytesToHex(sha256(utf8ToBytes(list.join('\n') + '\n'))), V.wordlistSha256[name]);
  }

  // BIP-32 vectors 1-4: every chain, private and public serialisation, public derivation of the normal steps.
  V.bip32.forEach((v, n) => {
    const master = HDKey.fromMasterSeed(hexToBytes(v.seed));
    for (const c of v.chains) {
      const k = master.derive(c.path);
      eq(`bip32 #${n + 1} ${c.path} prv`, k.xprv, c.xprv);
      eq(`bip32 #${n + 1} ${c.path} pub`, k.xpub, c.xpub);
      eq(`bip32 #${n + 1} ${c.path} parse`, HDKey.fromExtendedKey(c.xprv).xpub, c.xpub);
      // The last element derived from the parent's xpub when it is not hardened.
      const idx = parsePath(c.path);
      if (idx.length && idx[idx.length - 1] < HARDENED) {
        const parent = HDKey.fromExtendedKey(master.derive(formatPath(idx.slice(0, -1))).xpub);
        eq(`bip32 #${n + 1} ${c.path} from xpub`, parent.deriveChild(idx[idx.length - 1]).xpub, c.xpub);
      }
    }
  });
  // BIP-32 vector 5: invalid extended keys.
  for (const [key, why] of V.bip32Invalid) throws(`bip32 invalid: ${why}`, () => HDKey.fromExtendedKey(key));
  throws('hardened from xpub', () => HDKey.fromExtendedKey(V.bip32[0].chains[0].xpub).deriveChild(HARDENED));
  eq('path parse', parsePath("m/84'/0h/0H/1/2"), [HARDENED + 84, HARDENED, HARDENED, 1, 2]);
  eq('path format', formatPath(parsePath("m/49h/1h/0h/0/7")), "m/49'/1'/0'/0/7");
  throws('path out of range', () => parsePath('m/2147483648'));
  throws('path garbage', () => parsePath('m/1x'));
  const m1 = HDKey.fromMasterSeed(hexToBytes(V.bip32[0].seed));
  eq('fingerprint', fingerprintHex(m1.fingerprint), '3442193e');
  eq('child parent fingerprint', fingerprintHex(m1.derive("m/0'").parentFingerprint), '3442193e');
  throws('absolute path below master', () => m1.derive("m/0'").derive("m/1"));
  eq('neuter', [m1.neuter().isPrivate, m1.neuter().xpub], [false, m1.xpub]);

  // BIP-39: Trezor reference vectors (passphrase "TREZOR").
  for (const [lang, vectors] of Object.entries(V.bip39)) {
    if (lang === 'passphrase') continue;
    const list = WORDLISTS[lang];
    for (const [ent, words, seed, xprv] of vectors) {
      const tag = `bip39 ${lang} ${ent.slice(0, 8)}…/${ent.length / 2}`;
      eq(tag + ' mnemonic', entropyToMnemonic(hexToBytes(ent), list).normalize('NFKD'), words.normalize('NFKD'));
      eq(tag + ' entropy', bytesToHex(mnemonicToEntropy(words, list)), ent);
      const s = mnemonicToSeed(words, V.bip39.passphrase);
      eq(tag + ' seed', bytesToHex(s), seed);
      eq(tag + ' xprv', HDKey.fromMasterSeed(s).xprv, xprv);
      eq(tag + ' list', wordlistOf(words) === lang || (lang === 'chinese_traditional' && wordlistOf(words) === 'chinese_simplified'), true);
    }
  }
  // Japanese vectors: NFKD of the phrase and of the passphrase, U+3000 between words.
  for (const [ent, words, pass, seed, xprv] of V.bip39jp) {
    const tag = `bip39 japanese ${ent.slice(0, 8)}…/${ent.length / 2}`;
    eq(tag + ' mnemonic', entropyToMnemonic(hexToBytes(ent), WORDLISTS.japanese).normalize('NFKD'), words.normalize('NFKD'));
    eq(tag + ' separator', entropyToMnemonic(hexToBytes(ent), WORDLISTS.japanese).split('　').length, words.split('　').length);
    const s = mnemonicToSeed(words, pass);
    eq(tag + ' seed', bytesToHex(s), seed);
    eq(tag + ' xprv', HDKey.fromMasterSeed(s).xprv, xprv);
  }
  const s0 = await mnemonicToSeedAsync(V.bip39.english[0][1], 'TREZOR');
  eq('bip39 async seed', bytesToHex(s0), V.bip39.english[0][2]);

  // Validation, errors, completion.
  const abandon = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  eq('valid', validateMnemonic(abandon), true);
  eq('checksum', checkMnemonic(abandon.replace(/about$/, 'abandon')).error, 'checksum');
  eq('unknown word', checkMnemonic(abandon.replace(/about$/, 'abaut')), { ok: false, error: 'word', words: abandon.replace(/about$/, 'abaut').split(' '), bad: [11] });
  eq('count', checkMnemonic('abandon about').error, 'count');
  eq('whitespace', validateMnemonic('  ' + abandon.replace(/ /g, '\n\t ') + ' '), true);
  eq('complete', completeWord('aba'), ['abandon']);
  eq('complete several', completeWord('ab', undefined, 3), ['abandon', 'ability', 'able']);
  eq('expand prefixes', expandWords('aban aban aban aban aban aban aban aban aban aban aban abou').join(' '), abandon);
  throws('bad entropy length', () => entropyToMnemonic(new Uint8Array(15)));
  const g = generateMnemonic(24);
  eq('generate 24', [g.split(' ').length, validateMnemonic(g)], [24, true]);
  eq('generate differs', generateMnemonic() !== generateMnemonic(), true);
  throws('generate 13', () => generateMnemonic(13));

  // SLIP-132 account keys of the BIP-49 / BIP-84 / BIP-86 test vectors ("abandon … about", no passphrase).
  const root = HDKey.fromMasterSeed(mnemonicToSeed(abandon));
  eq('bip84 root zprv', root.toExtendedKey('zprv'), 'zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5');
  eq('bip84 root zpub', root.toExtendedKey('zpub'), 'zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF');
  const a84 = root.derive("m/84'/0'/0'");
  eq('bip84 account zprv', a84.toExtendedKey('zprv'), 'zprvAdG4iTXWBoARxkkzNpNh8r6Qag3irQB8PzEMkAFeTRXxHpbF9z4QgEvBRmfvqWvGp42t42nvgGpNgYSJA9iefm1yYNZKEm7z6qUWCroSQnE');
  eq('bip84 account zpub', a84.toExtendedKey('zpub'), 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  eq('prefix', extendedKeyPrefix(a84.toExtendedKey('zpub')), 'zpub');
  eq('zpub -> xpub -> zpub', convertExtendedKey(convertExtendedKey(a84.toExtendedKey('zpub'), 'xpub'), 'zpub'), a84.toExtendedKey('zpub'));
  // SLIP-132 testnet native segwit: vpub is 0x045f1cf6 (the encoded key starts with 'vpub', not 'vpuG').
  eq('vpub version', VERSIONS.vpub.version, 0x045f1cf6);
  eq('vpub prefix', convertExtendedKey(a84.toExtendedKey('zpub'), 'vpub').slice(0, 4), 'vpub');
  const a49 = root.derive("m/49'/1'/0'");
  eq('bip49 testnet account tprv', a49.toExtendedKey('tprv'), 'tprv8gRrNu65W2Msef2BdBSUgFdRTGzC8EwVXnV7UGS3faeXtuMVtGfEdidVeGbThs4ELEoayCAzZQ4uUji9DUiAs7erdVskqju7hrBcDvDsdbY');
  eq('bip49 testnet account upub', a49.toExtendedKey('upub'), 'upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY');
  const a86 = root.derive("m/86'/0'/0'");
  eq('bip86 account xprv', a86.xprv, 'xprv9xgqHN7yz9MwCkxsBPN5qetuNdQSUttZNKw1dcYTV4mkaAFiBVGQziHs3NRSWMkCzvgjEe3n9xV8oYywvM8at9yRqyaZVz6TYYhX98VjsUk');
  eq('bip86 account xpub', a86.xpub, 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ');

  console.log(`hdkey: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
