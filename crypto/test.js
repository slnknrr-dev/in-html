// crypto/test.js - unit tests of the crypto library: `node crypto/test.js` (importing the module runs nothing).
// Published vectors: the MD2 / MD4 / MD5 test suites of RFC 1319 / 1320 / 1321, SHA-256 (FIPS 180-4 examples),
// Base58Check addresses of Bitcoin and of the XRP Ledger. The password strength estimator (dictionary words, l33t,
// keyboard layouts and walks, dates, repeats, sequences, random strings) and the password generator (groups,
// exclusions, exact entropy, uniform "every group" sampling, passphrases).
//
// Why published vectors: a self-consistency test (encrypt then decrypt) passes even for a wrong but invertible
// implementation; only external known-answer tests prove interoperability. Each hash is also fed in 7-byte pieces
// to exercise the block-buffering paths that one-shot calls never reach.
// Coverage gap (honest list): no known-answer tests here for SHA-1, SHA-512 family, SHA-3 / Keccak, BLAKE2, RIPEMD-160,
// HMAC / PBKDF2 / HKDF, AES modes, ChaCha20-Poly1305, Salsa20 (some are exercised by other folders' tests, e.g.
// keccak256 / scrypt / argon2id / blake2sp in ethereum, walletui, archive). Adding RFC / NIST vectors is the next step.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { md2 } from './md2.js';
import { md4 } from './md4.js';
import { md5 } from './md5.js';
import { sha256 } from './sha2.js';
import { base58checkDecode, base58checkEncode } from './base58check.js';
import { RADIX } from '../codec/radix.js';
import { ALPHABETS, generatePassphrase, passwordGenerator, passwordGroups, WORDS } from './password.js';
import { charsetEntropy, omnimatch, passwordStrength, quality } from './strength.js';
import { run as runEC } from './test-ec.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder();
const hex = (u) => Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

const SUITE = ['', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '1234567890'.repeat(8)];
const MD = {
  md2: [md2, ['8350e5a3e24c153df2275c9f80692773', '32ec01ec4a6dac72c0ab96fb34c0b5d1', 'da853b0d3f88d99b30283a69e6ded6bb',
    'ab4f496bfb2a530b219ff33031fe06b0', '4e8ddff3650292ab5a4108c3aa47940b', 'da33def2a42df13975352846c30338cd', 'd5976f79d83d3a0dc9806c3c66f3efd8']],
  md4: [md4, ['31d6cfe0d16ae931b73c59d7e0c089c0', 'bde52cb31de33e46245e05fbdbd6fb24', 'a448017aaf21d8525fc10ae87aa6729d',
    'd9130a8164549fe818874806e1c7014b', 'd79e1c308aa5bbcdeea8ed63df412da9', '043f8582f241db351ce627e153e7f0e4', 'e33b4ddc9c38f2199c3e7b164fcc0536']],
  md5: [md5, ['d41d8cd98f00b204e9800998ecf8427e', '0cc175b9c0f1b6a831c399e269772661', '900150983cd24fb0d6963f7d28e17f72',
    'f96b697d7cb7938d525a2f31aaf161d0', 'c3fcd3d76192e4007dfb496cca67e13b', 'd174ab98d277d9f5a5611c2c9f419d9f', '57edf4a22be3c955ac49da2e2107b67a']],
};

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch { pass++; } };

  for (const [name, [fn, digests]] of Object.entries(MD)) {
    SUITE.forEach((s, i) => eq(`${name} "${s.slice(0, 16)}"`, hex(fn(te.encode(s))), digests[i]));
    // Streaming in odd pieces gives the same digest.
    const h = fn.create();
    for (let i = 0; i < SUITE[6].length; i += 7) h.update(te.encode(SUITE[6].slice(i, i + 7)));
    eq(`${name} streamed`, hex(h.digest()), digests[6]);
  }
  eq('sha256 abc', hex(sha256(te.encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  eq('sha256 two blocks', hex(sha256(te.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');

  // Base58Check: a Bitcoin address (version 0x00 + RIPEMD-160 of a public key) and XRP Ledger accounts.
  eq('bitcoin address', base58checkEncode(fromHex('00010966776006953d5567439e5e39f86a0d273bee')), '16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM');
  eq('bitcoin address back', hex(base58checkDecode('16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM')), '00010966776006953d5567439e5e39f86a0d273bee');
  throws('bitcoin checksum', () => base58checkDecode('16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvN'));
  for (const [id, address] of [['0000000000000000000000000000000000000000', 'rrrrrrrrrrrrrrrrrrrrrhoLvTp'],
    ['0000000000000000000000000000000000000001', 'rrrrrrrrrrrrrrrrrrrrBZbvji'], ['b5f762798a53d543a014caf8b297cff8f2f937e8', 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh']]) {
    eq(`xrp ${address}`, base58checkEncode(fromHex('00' + id), RADIX.ripple58), address);
    eq(`xrp back ${address}`, hex(base58checkDecode(address, RADIX.ripple58)), '00' + id);
  }
  throws('xrp address with the bitcoin alphabet', () => base58checkDecode('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'));

  strengthTests(eq);
  generatorTests(eq);

  console.log(`crypto: ${pass} passed, ${fail} failed`);
  return fail + (await runEC());
}

// The zxcvbn-style estimator (strength.js): cheapest decompositions of known passwords, KeePassXC's quality levels.
function strengthTests(eq) {
  const S = (p, o) => passwordStrength(p, o);
  const only = (p) => { const r = S(p); return r.sequence.length === 1 ? r.sequence[0] : null; };
  const has = (p, fn) => omnimatch(p).some(fn);

  eq('quality levels', [0, 0.5, 39.99, 40, 74.99, 75, 99.99, 100, 300].map(quality), ['bad', 'poor', 'poor', 'weak', 'weak', 'good', 'good', 'excellent', 'excellent']);
  eq('empty password', [S('').entropy, S('').quality, S('').sequence.length], [0, 'bad', 0]);
  eq('charset entropy', charsetEntropy('abc1').bits.toFixed(6), (4 * Math.log2(36)).toFixed(6));
  eq('charset of mixed alphabets', charsetEntropy('aZ1!ж').pool, 26 + 26 + 10 + 33 + 33);

  const pw = S('password');
  eq('"password" is guessed in a handful of tries', pw.guesses < 10 && pw.sequence[0].pattern === 'dictionary' && pw.sequence[0].dictionary === 'passwords', true);
  eq('"password" feedback', pw.feedback.warning, 'top10');
  eq('"123456" is a top password', S('123456').entropy < 3, true);

  const chbs = S('correcthorsebatterystaple');
  eq('correcthorsebatterystaple > 40 bits', chbs.entropy > 40, true);
  eq('correcthorsebatterystaple < its charset entropy', chbs.entropy < chbs.charset.bits, true);
  eq('correcthorsebatterystaple is words', chbs.sequence.filter((m) => m.pattern === 'dictionary').length >= 3, true);

  eq('qwertyuiop is a straight keyboard row', has('qwertyuiop', (m) => m.pattern === 'spatial' && m.graph === 'qwerty' && m.i === 0 && m.j === 9 && m.turns === 1), true);
  eq('1qaz2wsx: two keyboard columns', ['1qaz', '2wsx'].every((t) => has('1qaz2wsx', (m) => m.pattern === 'spatial' && m.token === t)), true);
  eq('1qaz2wsx is weak', S('1qaz2wsx').entropy < 25, true);
  const walk = only('zxcvbnm,./');
  eq('zxcvbnm,./ is one spatial match', walk && walk.pattern === 'spatial' && walk.graph === 'qwerty', true);
  eq('shifted keyboard walk', has('!QAZ@WSX', (m) => m.pattern === 'spatial' && m.token === '!QAZ' && m.shifted === 4), true);
  eq('keypad walk with turns', has('9874123', (m) => m.pattern === 'spatial' && m.graph === 'keypad' && m.i === 0 && m.j === 6 && m.turns === 3), true);
  eq('JCUKEN keyboard walk', has('фывапролдж', (m) => m.pattern === 'spatial' && m.graph === 'jcuken' && m.j === 9), true);

  const date = only('19.07.1990');
  eq('date 19.07.1990', date && [date.pattern, date.day, date.month, date.year, date.separator], ['date', 19, 7, 1990, '.']);
  const date2 = only('07041976');
  eq('date without separators', date2 && date2.pattern === 'date' && date2.year === 1976, true);
  eq('recent year', has('ilove2019', (m) => m.pattern === 'regex' && m.token === '2019'), true);

  const leet = only('p@ssw0rd');
  eq('l33t p@ssw0rd', leet && [leet.pattern, leet.word, leet.l33t, leet.sub['@'], leet.sub['0']], ['dictionary', 'password', true, 'a', 'o']);
  eq('l33t p@ssw0rd is weak', S('p@ssw0rd').entropy < 10, true);
  eq('reversed word', only('drowssap')?.reversed, true);
  const rep = only('abcabcabc');
  eq('repeated sequence', rep && [rep.pattern, rep.base, rep.count], ['repeat', 'abc', 3]);
  eq('repeated character', only('zzzzzzzz')?.pattern, 'repeat');
  eq('odd digits are a sequence', only('13579')?.pattern, 'sequence');
  const cyr = only('абвгде');
  eq('Cyrillic sequence', cyr && [cyr.pattern, cyr.name], ['sequence', 'cyrillic']);
  eq('Greek sequence', only('ωψχφυ')?.ascending, false);

  const layout = only('gfhjkm');
  eq('Russian word typed in the Latin layout', layout && [layout.dictionary, layout.layout, layout.word], ['russian', 'ru', 'пароль']);
  const translit = only('privet');
  eq('transliterated Russian word', translit && translit.dictionary === 'russian' && translit.translit === 'привет', true);
  const cyrLayout = only('зфыыцщкв');
  eq('Latin word typed in the Russian layout', cyrLayout && [cyrLayout.layout, cyrLayout.word], ['en', 'password']);
  eq('Cyrillic word', only('солнышко')?.dictionary, 'russian');
  eq('user inputs', S('slnknrr2024', { userInputs: ['slnknrr'] }).sequence.some((m) => m.dictionary === 'user'), true);

  // Random strings are guessed by brute force: close to their charset entropy.
  const g = passwordGenerator({ length: 16, alphabets: ALPHABETS.slice(0, 9).map((a) => a.id), everyGroup: false });
  const ratios = Array.from({ length: 40 }, () => { const r = S(g.next()); return r.entropy / r.charset.bits; });
  eq('random 16-character strings: every estimate >= 75% of the charset entropy', Math.min(...ratios) >= 0.75, true);
  eq('random 16-character strings: mean estimate >= 90% of the charset entropy', ratios.reduce((a, b) => a + b) / ratios.length >= 0.9, true);
  eq('long input is analysed in pieces', S('Zx9!'.repeat(150)).pieces, 5);
}

// The generator (password.js): KeePassXC's groups, exclusions, exact entropy and uniformity of "every group".
function generatorTests(eq) {
  const size = (id) => [...ALPHABETS.find((a) => a.id === id).chars].length;
  eq('KeePassXC group sizes', ['upper', 'lower', 'digits', 'braces', 'punctuation', 'quotes', 'dashes', 'math', 'logograms', 'latin1'].map(size), [26, 26, 10, 6, 4, 2, 5, 7, 8, 94]);
  const plain = passwordGroups({ alphabets: ['upper', 'lower', 'digits'], lookAlike: true }).flatMap((g) => g.chars).join('');
  eq('look-alikes excluded', [...'0O1lIo6G8B'].some((c) => plain.includes(c)), false);
  const mixed = passwordGroups({ alphabets: ['lower', 'cyrillic'], lookAlike: true });
  eq('Cyrillic homoglyphs of Latin letters excluded', ['а', 'е', 'о', 'р', 'с', 'х'].some((c) => mixed[1].chars.includes(c)), false);
  eq('exclude and include', passwordGroups({ alphabets: ['digits'], exclude: '0123', include: '0ab' }).map((g) => g.chars.join('')), ['456789', 'ab']);
  let err = null;
  try { passwordGenerator({ length: 2, alphabets: ['upper', 'lower', 'digits'] }); } catch (e) { err = [e.code, e.min]; }
  eq('too short for every group', err, ['short', 3]);
  err = null;
  try { passwordGenerator({ alphabets: [] }); } catch (e) { err = e.code; }
  eq('no characters', err, 'empty');

  // {0, 1} and {x}, length 3, every group: 3^3 - 2^3 - 1^3 = 18 strings, drawn uniformly.
  const g = passwordGenerator({ alphabets: ['digits'], exclude: '23456789', include: 'x', length: 3 });
  eq('exact entropy with every group', g.entropy.toFixed(9), Math.log2(18).toFixed(9));
  const counts = new Map();
  for (let i = 0; i < 3600; i++) { const s = g.next(); counts.set(s, (counts.get(s) || 0) + 1); }
  eq('every group: all 18 strings occur, each with both groups', counts.size === 18 && [...counts.keys()].every((s) => /x/.test(s) && /[01]/.test(s)), true);
  eq('every group: uniform (each 200 ± 70 of 3600)', [...counts.values()].every((n) => n > 130 && n < 270), true);

  // KeePassXC's nine ASCII groups, length 20: exact count = inclusion-exclusion over the groups.
  const ids = ALPHABETS.slice(0, 9).map((a) => a.id);
  const sizes = ids.map(size), P = sizes.reduce((a, b) => a + b);
  let ratio = 0;
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    let removed = 0, odd = 0;
    for (let i = 0; i < sizes.length; i++) if (mask & (1 << i)) { removed += sizes[i]; odd ^= 1; }
    ratio += (odd ? -1 : 1) * ((P - removed) / P) ** 20;
  }
  const g20 = passwordGenerator({ alphabets: ids, length: 20 });
  eq('entropy of 20 characters from every ASCII group', g20.entropy.toFixed(6), (20 * Math.log2(P) + Math.log2(ratio)).toFixed(6));
  const pw = g20.next();
  eq('generated password uses every group', [...pw].length === 20 && g20.groups.every((gr) => gr.chars.some((c) => pw.includes(c))), true);
  eq('free choice: length x log2(pool)', passwordGenerator({ alphabets: ['lower'], length: 10 }).entropy, 10 * Math.log2(26));
  const emoji = passwordGenerator({ alphabets: ['emoji', 'greek'], length: 12 }).next();
  eq('emoji and Greek: 12 characters', [...emoji].length, 12);

  const pp = generatePassphrase({ words: 5, wordCase: 'upper', list: WORDS, separator: ' ' });
  eq('passphrase words and case', pp.password.split(' ').length === 5 && pp.password === pp.password.toUpperCase(), true);
  eq('passphrase entropy', pp.entropy, 5 * Math.log2(WORDS.length));
  const mx = generatePassphrase({ words: 4, wordCase: 'mixed', number: true, symbol: true, list: ['alpha', 'beta', 'gamma', 'delta', 'Alpha'] });
  eq('passphrase options: entropy and distinct list', [mx.size, mx.entropy.toFixed(9)], [4, (4 * 2 + 4 * Math.log2(3) + Math.log2(40) + Math.log2(48)).toFixed(9)]);
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
