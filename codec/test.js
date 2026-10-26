// codec/test.js - unit tests of the binary-to-text encodings: `node codec/test.js` (importing the module runs nothing).
// Published vectors of each specification, reference outputs of Python's base64 / binascii / quopri / urllib.parse
// (embedded below), BigInt and URLSearchParams cross-checks, and fuzzed round trips of every codec.
//
// Test strategy: three independent oracles, because a round trip alone proves only that encode and decode are
// inverse, not that either matches the standard (a codec with a swapped digit order round-trips perfectly).
//   1. Published vectors (RFCs, BIPs) - the normative truth.
//   2. Reference outputs captured from Python's stdlib - widely deployed behaviour, including corner cases the RFCs
//      leave open (partial groups, line wrapping).
//   3. Native cross-checks (BigInt.toString, URLSearchParams) - a second implementation in the same runtime.
// Fuzzed round trips then cover lengths and byte values no vector picks (0-length, all-zero, 0xFF runs).
// isMain guard: tests run only as `node codec/test.js`, so a bundler or another test importing this file does not
// execute them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RADIX, byteDigits, parseByteDigits, radixDecode, radixEncode } from './radix.js';
import { B16, B32, B32HEX, B64, B64URL, CROCKFORD, CROCKFORD_ALIASES, GMP64, ZBASE32, bitsDecode, bitsEncode } from './rfc4648.js';
import { base45Decode, base45Encode } from './base45.js';
import { Z85, ascii85Decode, ascii85Encode, base85Decode, base85Encode } from './base85.js';
import { base91Decode, base91Encode } from './base91.js';
import { base92Decode, base92Encode } from './base92.js';
import { base100Decode, base100Encode } from './base100.js';
import { bech32Decode, bech32Encode, decodeBytes, encodeBytes, fromWords } from './bech32.js';
import { uuDecode, uuEncode } from './uu.js';
import { yencDecode, yencEncode } from './yenc.js';
import { qpDecode, qpEncode } from './quoted-printable.js';
import { percentDecode, percentEncode } from './percent.js';
import { domainToASCII, domainToUnicode, punycodeDecode, punycodeEncode } from './punycode.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const te = new TextEncoder(), td = new TextDecoder();
const hex = (u) => Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

// Python 3.14: base64.b85encode / a85encode (adobe) / z85encode, binascii.b2a_uu (backtick), quopri.encodestring (line
// ends as LF), urllib.parse.quote(safe='').
const PYTHON = [
  { hex: '48656c6c6f2c20776f726c6421', b85: 'NM&qnZ!92pZ*pv8Ap', a85: '87cURD_*#TDfTZ)+T', z85: 'nm=QNz.92Pz/PV8aP',
    uu: '-2&5L;&\\L(\'=O<FQD(0``\n', qp: 'Hello, world!', pct: 'Hello%2C%20world%21' },
  { hex: '0000000001fffe', b85: '000000ssC', a85: 'z!WW-', z85: '000000SSc', uu: '\'``````\'__@``\n',
    qp: '=00=00=00=00=01=FF=FE', pct: '%00%00%00%00%01%FF%FE' },
  { hex: 'd09fd180d0b8d0b2d0b5d18220f09f9880', b85: '(4WzO(74dD(6!NmAn>1<fB', a85: 'd%A^9d(%H.d\'_8Q+Rl"jJ,', z85: '^4wZo^74Dd^6.nMaN(1<Fb',
    uu: '1T)_1@-"XT++0M=&"(/"?F(``\n', qp: '=D0=9F=D1=80=D0=B8=D0=B2=D0=B5=D1=82 =F0=9F=98=80',
    pct: '%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%F0%9F%98%80' },
  { hex: '6c696e65206f6e6520200d0a6c696e653d74776f090a656e642e', b85: 'Y-w&~Aa8DEARrA2Y-w&~J#=?(2?}LyWG(',
    a85: 'Ch[cu+E)./+<V+#Ch[cu4`kmd#mt6]A1d', z85: 'y?W=#aA8dearRa2y?W=#j->)^2)$lYwg^', uu: ':;&EN92!O;F4@(`T*;&EN93UT=V\\)"F5N9"X`\n',
    qp: 'line one =20\nline=3Dtwo=09\nend.', pct: 'line%20one%20%20%0D%0Aline%3Dtwo%09%0Aend.' },
  { hex: '00070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0e7eef5fc', b85: '00#~g93v_*I6p>BR9j+caCd%%jFXz7sIRuY#LLpz;OFl3`~',
    a85: '!!`uK*$Zpf3\'Tl,<*NgGE-HbbN0B^(W3<YC`66T^i90P$qu', z85: '00-#G93V{/i6P(br9J*CAcD++JfxZ7SirUy-llPZ&ofL3}#',
    uu: 'E``<.%1PC*C$X/T9-5%MB:7!W?H6,DYJAJ*^VO<3+TMG@Y^[U_```\n',
    qp: '=00=07=0E=15=1C#*18?FMT[bipw~=85=8C=93=9A=A1=A8=AF=B6=BD=C4=CB=D2=D9=E0=E7=\n=EE=F5=FC',
    pct: '%00%07%0E%15%1C%23%2A18%3FFMT%5Bbipw~%85%8C%93%9A%A1%A8%AF%B6%BD%C4%CB%D2%D9%E0%E7%EE%F5%FC' },
];

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch { pass++; } };
  const rt = (name, bytes, enc, dec) => {
    try { eq(name, hex(dec(enc(bytes))), hex(bytes)); } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
  };

  // --- RFC 4648 §10 ------------------------------------------------------------------------------------
  const RFC = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'];
  const want = {
    b16: ['', '66', '666F', '666F6F', '666F6F62', '666F6F6261', '666F6F626172'],
    b32: ['', 'MY======', 'MZXQ====', 'MZXW6===', 'MZXW6YQ=', 'MZXW6YTB', 'MZXW6YTBOI======'],
    b32hex: ['', 'CO======', 'CPNG====', 'CPNMU===', 'CPNMUOG=', 'CPNMUOJ1', 'CPNMUOJ1E8======'],
    b64: ['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy'],
  };
  RFC.forEach((s, i) => {
    const b = te.encode(s);
    eq(`base16 ${s}`, bitsEncode(b, B16), want.b16[i]);
    eq(`base32 ${s}`, bitsEncode(b, B32, { pad: true }), want.b32[i]);
    eq(`base32hex ${s}`, bitsEncode(b, B32HEX, { pad: true }), want.b32hex[i]);
    eq(`base64 ${s}`, bitsEncode(b, B64, { pad: true }), want.b64[i]);
    eq(`base64 back ${s}`, td.decode(bitsDecode(want.b64[i], B64)), s);
    eq(`base32 back ${s}`, td.decode(bitsDecode(want.b32[i].toLowerCase(), B32, { caseless: true })), s);
  });
  eq('base64url', bitsEncode(Uint8Array.of(251, 255), B64URL), '-_8');
  eq('base64 wrap', bitsEncode(new Uint8Array(60), B64, { pad: true, wrap: 76 }).split('\n').map((l) => l.length), [76, 4]);
  throws('base64 trailing bits', () => bitsDecode('Zh==', B64));
  throws('base64 impossible length', () => bitsDecode('Zm9vY', B64));
  throws('base64 bad character', () => bitsDecode('Zm9*', B64));
  eq('crockford', bitsEncode(te.encode('foobar'), CROCKFORD), 'CSQPYRK1E8');
  eq('crockford look-alikes and hyphens', td.decode(bitsDecode('csqp-yrkie8', CROCKFORD, { caseless: true, aliases: CROCKFORD_ALIASES, ignore: '-' })), 'foobar');
  eq('z-base-32', bitsEncode(te.encode('foobar'), ZBASE32), 'c3zs6aubqe');
  eq('gmp base64', bitsEncode(te.encode('foobar'), GMP64), [...'Zm9vYmFy'].map((c) => GMP64[B64.indexOf(c)]).join(''));

  // --- big numbers and digits per byte -------------------------------------------------------------------
  eq('base58', radixEncode(te.encode('Hello World!'), RADIX.base58), '2NEpo7TZRRrLZSi2U');
  eq('base58 leading zeros', radixEncode(fromHex('00000102'), RADIX.base58), '115T');
  eq('base58 back', hex(radixDecode('115T', RADIX.base58)), '00000102');
  eq('base58 all zeros', hex(radixDecode(radixEncode(new Uint8Array(3), RADIX.base58), RADIX.base58)), '000000');
  eq('base62', radixEncode(te.encode('Hello'), RADIX.base62), '5TP3P3v');
  eq('ripple base58 is a permutation', [...RADIX.ripple58].sort().join(''), [...RADIX.base58].sort().join(''));
  eq('ripple base58 zeros', radixEncode(new Uint8Array(3), RADIX.ripple58), 'rrr');
  eq('base36 caseless', hex(radixDecode('3yud78mn', RADIX.base36, { caseless: true })), hex(te.encode('Hello')));
  throws('base58 has no 0', () => radixDecode('10', RADIX.base58));
  let seed = 99;
  const rnd = (m) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m;
  for (let i = 0; i < 40; i++) {
    const b = Uint8Array.from({ length: 1 + rnd(i < 30 ? 40 : 3000) }, () => rnd(256));
    b[0] ||= 1;
    const big = BigInt('0x' + hex(b));
    eq(`base36 vs BigInt ${i}`, radixEncode(b, RADIX.base36), big.toString(36).toUpperCase());
    eq(`base10 vs BigInt ${i}`, radixEncode(b, RADIX.base10), big.toString(10));
    eq(`base2 vs BigInt ${i}`, radixEncode(b, RADIX.base2), big.toString(2));
  }
  eq('binary digits', byteDigits(te.encode('Hi'), 2), '01001000 01101001');
  eq('decimal digits', byteDigits(te.encode('Hi'), 10, { sep: ',' }), '72,105');
  eq('octal run', hex(parseByteDigits('110151', 8)), hex(te.encode('Hi')));
  throws('decimal above 255', () => parseByteDigits('256', 10));

  // --- Base45, Base85 family, basE91, Base92, Base100 ------------------------------------------------------
  for (const [i, o] of [['AB', 'BB8'], ['Hello!!', '%69 VD92EX0'], ['base-45', 'UJCLQE7W581'], ['ietf!', 'QED8WEX0']]) {
    eq(`base45 ${i}`, base45Encode(te.encode(i)), o);
    eq(`base45 back ${i}`, td.decode(base45Decode(o)), i);
  }
  throws('base45 out of range', () => base45Decode('GGW'));
  eq('z85 spec', base85Encode(fromHex('864FD26FB559F75B'), Z85), 'HelloWorld');
  for (const [k, r] of PYTHON.entries()) {
    const b = fromHex(r.hex);
    eq(`b85 python ${k}`, base85Encode(b), r.b85);
    eq(`a85 python ${k}`, ascii85Encode(b), r.a85);
    eq(`adobe85 python ${k}`, ascii85Encode(b, { adobe: true }), `<~${r.a85}~>`);
    eq(`z85 python ${k}`, base85Encode(b, Z85), r.z85);
    eq(`uu python ${k}`, uuEncode(b, { frame: false }), r.uu);
    eq(`qp python ${k}`, qpEncode(b, { eol: '\n' }), r.qp);
    eq(`percent python ${k}`, percentEncode(b), r.pct);
  }
  eq('ascii85 y', ascii85Encode(te.encode('    '), { foldSpaces: true }), 'y');
  eq('basE91 test', base91Encode(te.encode('test')), 'fPNKd');
  eq('basE91 hello', base91Encode(te.encode('Hello, world!')), '>OwJh>}A"=r@@Y?F');
  eq('base92 hello world', base92Encode(te.encode('hello world')), 'Fc_$aOTdKnsM*k');
  eq('base92 empty', base92Encode(new Uint8Array(0)), '~');
  eq('base100', base100Encode(te.encode('hello')), '👟👜👣👣👦');

  // --- Bech32 / Bech32m (BIP-173, BIP-350) ----------------------------------------------------------------
  for (const v of ['A12UEL5L', 'a12uel5l', 'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw', 'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
    '?1ezyfcl', 'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs']) eq(`bech32 ${v}`, bech32Decode(v).variant, 'bech32');
  for (const v of ['A1LQFN3A', 'a1lqfn3a', 'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx', 'split1checkupstagehandshakeupstreamerranterredcaperredlc445v', '?1v759aa'])
    eq(`bech32m ${v}`, bech32Decode(v).variant, 'bech32m');
  for (const v of ['abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw', 'a1lqfn3a']) {
    const d = bech32Decode(v);
    eq(`bech32 re-encode ${v}`, bech32Encode(d.hrp, d.words, d.variant), v);
  }
  for (const bad of ['A12Uel5l', 'pzry9x0s0muk', '1pzry9x0s0muk', 'x1b4n0q5v', 'li1dgmt3', 'A1G7SGD8']) throws(`bech32 invalid ${bad}`, () => bech32Decode(bad));
  const p2wpkh = bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  eq('segwit v0 program', [p2wpkh.words[0], hex(fromWords(p2wpkh.words.slice(1)))], [0, '751e76e8199196d454941c45d1b3a323f1433bd6']);

  // --- UUencode / XXencode, yEnc, quoted-printable, percent-encoding --------------------------------------
  const framed = uuEncode(te.encode('Hello'), { name: 'a.txt', mode: '600' });
  eq('uu frame', framed, 'begin 600 a.txt\n%2&5L;&\\`\n`\nend\n');
  eq('uu frame back', (({ bytes, name, mode }) => [td.decode(bytes), name, mode])(uuDecode(framed)), ['Hello', 'a.txt', '600']);
  eq('xx autodetect without lower case', hex(uuDecode(uuEncode(new Uint8Array(6), { table: 'xx' })).bytes), '000000000000');
  throws('begin-base64 is not uu', () => uuDecode('begin-base64 644 x\nAAAA\n====\n'));
  const y = yencDecode(yencEncode(Uint8Array.from({ length: 300 }, (_, i) => i & 255), { name: 'x.bin', line: 64 }));
  eq('yenc facts', [y.name, y.size, y.sizeOk, y.crcOk, y.bytes.length], ['x.bin', 300, true, true, 300]);
  const damaged = yencEncode(te.encode('payload'));
  damaged[damaged.indexOf(10) + 1] ^= 1;
  eq('yenc damaged crc', yencDecode(damaged).crcOk, false);
  eq('qp soft breaks', qpEncode(te.encode('x'.repeat(100))).split('\r\n').map((l) => l.length), [76, 25]);
  eq('qp back', td.decode(qpDecode('caf=C3=A9 =\r\nsoft=3d')), 'café soft=');
  for (const s of ['a b&c=d', 'ü*~-._!\'()', 'x+y/z?#']) eq(`form ${s}`, percentEncode(te.encode(s), { mode: 'form' }), new URLSearchParams({ q: s }).toString().slice(2));
  eq('percent uri', percentEncode(te.encode('https://ex.am/p?q=1&r=ü#f'), { mode: 'uri' }), 'https://ex.am/p?q=1&r=%C3%BC#f');
  eq('percent back', td.decode(percentDecode('a%20b+c%zz', { plus: true })), 'a b c%zz');

  // --- Punycode (RFC 3492 §7.1) and IDNA ---------------------------------------------------------------
  for (const [u, a] of [['bücher', 'bcher-kva'], ['ليهمابتكلموشعربي؟', 'egbpdaj6bu4bxfgehfvwxn'], ['他们为什么不说中文', 'ihqwcrb4cv8a8dqg056pqjye'],
    ['почемужеонинеговорятпорусски', 'b1abfaaepdrnnbgefbadotcwatmq2g4l']]) {
    eq(`punycode ${a}`, punycodeEncode(u), a);
    eq(`punycode back ${a}`, punycodeDecode(a), u);
  }
  eq('idna', domainToASCII('Bücher.example'), 'xn--bcher-kva.example');
  eq('idna back', domainToUnicode('xn--mnchen-3ya.de'), 'münchen.de');

  // --- fuzzed round trips ------------------------------------------------------------------------------
  const inputs = [new Uint8Array(0), Uint8Array.of(0), new Uint8Array(5), te.encode('    \n. =\t')];
  for (let i = 0; i < 60; i++) inputs.push(Uint8Array.from({ length: rnd(i < 40 ? 50 : 400) }, () => rnd(256)));
  inputs.forEach((b, i) => {
    for (const [k, a, o] of [['b32', B32, { pad: true }], ['b32hex', B32HEX, {}], ['crockford', CROCKFORD, {}], ['zbase32', ZBASE32, {}],
      ['b64', B64, { pad: true, wrap: 64 }], ['b64url', B64URL, {}], ['gmp', GMP64, {}], ['b16', B16, {}]]) {
      rt(`${k} ${i}`, b, (x) => bitsEncode(x, a, o), (s) => bitsDecode(s, a, { caseless: a.length <= 32 }));
    }
    for (const [k, a] of Object.entries(RADIX)) rt(`radix ${k} ${i}`, b, (x) => radixEncode(x, a), (s) => radixDecode(s, a));
    for (const base of [2, 8, 10, 16]) rt(`digits ${base} ${i}`, b, (x) => byteDigits(x, base), (s) => parseByteDigits(s, base));
    rt(`base45 ${i}`, b, base45Encode, base45Decode);
    rt(`base85 ${i}`, b, (x) => base85Encode(x), (s) => base85Decode(s));
    rt(`z85 ${i}`, b, (x) => base85Encode(x, Z85), (s) => base85Decode(s, Z85));
    rt(`ascii85 ${i}`, b, (x) => ascii85Encode(x, { foldSpaces: true, wrap: 60 }), (s) => ascii85Decode(s));
    rt(`adobe85 ${i}`, b, (x) => ascii85Encode(x, { adobe: true }), (s) => ascii85Decode(s));
    rt(`basE91 ${i}`, b, base91Encode, base91Decode);
    rt(`base92 ${i}`, b, base92Encode, base92Decode);
    rt(`base100 ${i}`, b, base100Encode, base100Decode);
    rt(`bech32m ${i}`, b, (x) => encodeBytes('data', x, 'bech32m', { limit: 0 }), (s) => decodeBytes(s, { limit: 0 }).bytes);
    rt(`uu ${i}`, b, (x) => uuEncode(x), (s) => uuDecode(s).bytes);
    rt(`xx ${i}`, b, (x) => uuEncode(x, { table: 'xx' }), (s) => uuDecode(s).bytes);
    rt(`yenc ${i}`, b, (x) => yencEncode(x, { line: 32 }), (s) => yencDecode(s).bytes);
    rt(`qp ${i}`, b, (x) => qpEncode(x, { binary: true }), qpDecode);
    for (const mode of ['component', 'uri', 'form', 'all']) rt(`percent ${mode} ${i}`, b, (x) => percentEncode(x, { mode }), (s) => percentDecode(s, { plus: mode === 'form' }));
  });

  console.log(`codec: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
